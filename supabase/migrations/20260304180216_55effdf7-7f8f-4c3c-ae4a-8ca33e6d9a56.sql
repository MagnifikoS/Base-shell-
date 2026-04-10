
-- 1. Add 'litige' to commande_status enum
ALTER TYPE commande_status ADD VALUE IF NOT EXISTS 'litige' AFTER 'expediee';

-- 2. Create litiges table
CREATE TABLE public.litiges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_id uuid NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'open',
  note text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT litiges_status_check CHECK (status IN ('open', 'resolved'))
);

-- 3. Create litige_lines table
CREATE TABLE public.litige_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  litige_id uuid NOT NULL REFERENCES litiges(id) ON DELETE CASCADE,
  commande_line_id uuid NOT NULL REFERENCES commande_lines(id),
  shipped_quantity numeric NOT NULL,
  received_quantity numeric NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Indexes
CREATE INDEX idx_litiges_commande_id ON litiges(commande_id);
CREATE INDEX idx_litiges_status ON litiges(status);
CREATE INDEX idx_litige_lines_litige_id ON litige_lines(litige_id);

-- 5. RLS
ALTER TABLE litiges ENABLE ROW LEVEL SECURITY;
ALTER TABLE litige_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parties can view litiges" ON litiges
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM commandes c
      JOIN user_establishments ue ON ue.user_id = auth.uid()
      WHERE c.id = litiges.commande_id
        AND (c.client_establishment_id = ue.establishment_id
             OR c.supplier_establishment_id = ue.establishment_id)
    )
  );

CREATE POLICY "Parties can view litige_lines" ON litige_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM litiges l
      JOIN commandes c ON c.id = l.commande_id
      JOIN user_establishments ue ON ue.user_id = auth.uid()
      WHERE l.id = litige_lines.litige_id
        AND (c.client_establishment_id = ue.establishment_id
             OR c.supplier_establishment_id = ue.establishment_id)
    )
  );

-- 6. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE litiges;
ALTER PUBLICATION supabase_realtime ADD TABLE litige_lines;

-- 7. fn_resolve_litige RPC — FO validates litige + adjusts supplier stock
CREATE OR REPLACE FUNCTION public.fn_resolve_litige(
  p_litige_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_litige RECORD;
  v_commande RECORD;
  v_line RECORD;
  v_delta numeric;
  v_supplier_product_id uuid;
  v_zone_id uuid;
  v_snapshot_id uuid;
  v_org_id uuid;
  v_unit_family text;
  v_unit_label text;
  v_doc_id uuid;
  v_context_hash text;
  v_adjusted_count int := 0;
BEGIN
  -- Lock litige
  SELECT * INTO v_litige FROM litiges WHERE id = p_litige_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'litige_not_found');
  END IF;
  IF v_litige.status != 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_resolved');
  END IF;

  -- Lock commande
  SELECT * INTO v_commande FROM commandes WHERE id = v_litige.commande_id FOR UPDATE;
  IF v_commande.status != 'litige' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_commande_status');
  END IF;

  -- Verify caller is supplier member
  IF NOT EXISTS (
    SELECT 1 FROM user_establishments
    WHERE user_id = p_user_id AND establishment_id = v_commande.supplier_establishment_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'access_denied');
  END IF;

  -- Get supplier org
  SELECT organization_id INTO v_org_id
  FROM establishments WHERE id = v_commande.supplier_establishment_id;

  -- Process each litige line with positive delta (FO gets stock back)
  FOR v_line IN
    SELECT ll.id AS ll_id, ll.commande_line_id, ll.shipped_quantity, ll.received_quantity,
           cl.product_id AS client_product_id, cl.canonical_unit_id
    FROM litige_lines ll
    JOIN commande_lines cl ON cl.id = ll.commande_line_id
    WHERE ll.litige_id = p_litige_id
      AND ll.shipped_quantity > ll.received_quantity
  LOOP
    v_delta := v_line.shipped_quantity - v_line.received_quantity;

    -- Map client product → supplier product via b2b_imported_products
    SELECT bip.source_product_id INTO v_supplier_product_id
    FROM b2b_imported_products bip
    WHERE bip.local_product_id = v_line.client_product_id
      AND bip.establishment_id = v_commande.client_establishment_id
      AND bip.source_establishment_id = v_commande.supplier_establishment_id
    LIMIT 1;

    IF v_supplier_product_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Get supplier product's storage zone
    SELECT p.storage_zone_id INTO v_zone_id
    FROM products_v2 p
    WHERE p.id = v_supplier_product_id;

    IF v_zone_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Get active snapshot for this zone
    SELECT zss.snapshot_version_id INTO v_snapshot_id
    FROM zone_stock_snapshots zss
    WHERE zss.storage_zone_id = v_zone_id
      AND zss.establishment_id = v_commande.supplier_establishment_id;

    IF v_snapshot_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Get unit info for canonical_family / canonical_label
    SELECT mu.family, mu.label INTO v_unit_family, v_unit_label
    FROM measurement_units mu
    WHERE mu.id = v_line.canonical_unit_id;

    IF v_unit_family IS NULL THEN
      v_unit_family := 'unit';
    END IF;

    v_context_hash := 'auto:litige:' || v_supplier_product_id || ':' || v_line.canonical_unit_id || ':' || COALESCE(v_unit_family, 'unit');

    -- Create ADJUSTMENT stock document (one per line, idempotent)
    INSERT INTO stock_documents (
      establishment_id, organization_id, storage_zone_id,
      type, status, created_by,
      idempotency_key
    ) VALUES (
      v_commande.supplier_establishment_id, v_org_id, v_zone_id,
      'ADJUSTMENT', 'DRAFT', p_user_id,
      'litige_resolve:' || p_litige_id || ':' || v_line.commande_line_id
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_doc_id;

    IF v_doc_id IS NOT NULL THEN
      INSERT INTO stock_events (
        document_id, product_id, storage_zone_id,
        delta_quantity_canonical, canonical_unit_id, canonical_family,
        canonical_label, event_type, event_reason,
        snapshot_version_id, context_hash,
        establishment_id, organization_id,
        override_flag, override_reason,
        posted_at, posted_by
      ) VALUES (
        v_doc_id, v_supplier_product_id, v_zone_id,
        v_delta, v_line.canonical_unit_id, v_unit_family,
        v_unit_label, 'ADJUSTMENT', 'LITIGE_CORRECTION',
        v_snapshot_id, v_context_hash,
        v_commande.supplier_establishment_id, v_org_id,
        true, 'Ajustement litige commande',
        now(), p_user_id
      );

      -- Post the document
      UPDATE stock_documents
      SET status = 'POSTED', posted_at = now(), posted_by = p_user_id
      WHERE id = v_doc_id;

      v_adjusted_count := v_adjusted_count + 1;
    END IF;
  END LOOP;

  -- Resolve litige
  UPDATE litiges
  SET status = 'resolved', resolved_by = p_user_id, resolved_at = now()
  WHERE id = p_litige_id;

  -- Move commande to recue
  UPDATE commandes
  SET status = 'recue', updated_at = now()
  WHERE id = v_litige.commande_id;

  RETURN jsonb_build_object('ok', true, 'adjusted_lines', v_adjusted_count);
END;
$$;
