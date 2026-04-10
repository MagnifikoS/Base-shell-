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

    -- FIX: mu.name instead of mu.label (column does not exist)
    SELECT mu.family, mu.name INTO v_unit_family, v_unit_label
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

  -- Move commande to recue (terminal state for completed reception)
  UPDATE commandes
  SET status = 'recue', updated_at = now()
  WHERE id = v_litige.commande_id;

  RETURN jsonb_build_object('ok', true, 'adjusted_lines', v_adjusted_count);
END;
$$;