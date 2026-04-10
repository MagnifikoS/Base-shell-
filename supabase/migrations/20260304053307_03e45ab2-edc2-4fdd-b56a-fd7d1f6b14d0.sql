
-- ═══════════════════════════════════════════════════════════════
-- COMMANDES B2B ÉTAPE 2 — CORRECTIONS SÉCURITÉ & STOCK
-- ═══════════════════════════════════════════════════════════════

-- ═══ 1. FIX RLS: Lock commandes after brouillon/envoyee ═══

-- 1a. commandes_update: client can only update in brouillon/envoyee
DROP POLICY IF EXISTS "commandes_update" ON commandes;
CREATE POLICY "commandes_update" ON commandes FOR UPDATE
USING (
  client_establishment_id IN (SELECT get_user_establishment_ids())
  AND status IN ('brouillon', 'envoyee')
);

-- 1b. commande_lines_insert: client can only insert in brouillon/envoyee
DROP POLICY IF EXISTS "commande_lines_insert" ON commande_lines;
CREATE POLICY "commande_lines_insert" ON commande_lines FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM commandes c
    WHERE c.id = commande_lines.commande_id
      AND c.client_establishment_id IN (SELECT get_user_establishment_ids())
      AND c.status IN ('brouillon', 'envoyee')
  )
);

-- 1c. commande_lines_update: client can only update in brouillon/envoyee
DROP POLICY IF EXISTS "commande_lines_update" ON commande_lines;
CREATE POLICY "commande_lines_update" ON commande_lines FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM commandes c
    WHERE c.id = commande_lines.commande_id
      AND c.client_establishment_id IN (SELECT get_user_establishment_ids())
      AND c.status IN ('brouillon', 'envoyee')
  )
);

-- 1d. commande_lines_delete: client can only delete in brouillon/envoyee
DROP POLICY IF EXISTS "commande_lines_delete" ON commande_lines;
CREATE POLICY "commande_lines_delete" ON commande_lines FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM commandes c
    WHERE c.id = commande_lines.commande_id
      AND c.client_establishment_id IN (SELECT get_user_establishment_ids())
      AND c.status IN ('brouillon', 'envoyee')
  )
);

-- 1e. Supplier preparation policy stays unchanged (only status='ouverte')
-- Already correct: "Supplier can update lines during preparation"

-- ═══ 2. FIX fn_update_commande_if_unlocked ═══

CREATE OR REPLACE FUNCTION public.fn_update_commande_if_unlocked(
  p_commande_id uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status commande_status;
BEGIN
  SELECT status INTO v_status
  FROM commandes
  WHERE id = p_commande_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_status NOT IN ('brouillon', 'envoyee') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'locked');
  END IF;

  UPDATE commandes
  SET note = p_note, updated_at = now()
  WHERE id = p_commande_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ═══ 3. ADD FK: commande_lines.product_id → products_v2(id) ON DELETE RESTRICT ═══

ALTER TABLE commande_lines
ADD CONSTRAINT commande_lines_product_id_fkey
FOREIGN KEY (product_id) REFERENCES products_v2(id) ON DELETE RESTRICT;

-- ═══ 4. REWRITE fn_ship_commande with validation + stock ledger ═══

CREATE OR REPLACE FUNCTION public.fn_ship_commande(
  p_commande_id uuid,
  p_lines jsonb,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commande record;
  v_line_input jsonb;
  v_all_processed boolean := true;
  v_line_count int := 0;
  v_doc_id uuid;
  v_post_result jsonb;
  v_idemp_key text;
  v_supplier_product record;
  v_supplier_est record;
  v_zone_id uuid;
  v_org_id uuid;
BEGIN
  -- ═══ 0. Lock commande ═══
  SELECT * INTO v_commande
  FROM commandes
  WHERE id = p_commande_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'commande_not_found');
  END IF;

  IF v_commande.status != 'ouverte' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'current', v_commande.status);
  END IF;

  -- ═══ 1. Update lines with shipped quantities ═══
  FOR v_line_input IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    UPDATE commande_lines
    SET shipped_quantity = (v_line_input->>'shipped_quantity')::numeric,
        line_status = v_line_input->>'line_status'
    WHERE id = (v_line_input->>'line_id')::uuid
      AND commande_id = p_commande_id;

    v_line_count := v_line_count + 1;
  END LOOP;

  -- ═══ 2. Check all lines are processed ═══
  SELECT NOT EXISTS (
    SELECT 1 FROM commande_lines
    WHERE commande_id = p_commande_id
      AND line_status IS NULL
  ) INTO v_all_processed;

  IF NOT v_all_processed THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lines_not_all_processed');
  END IF;

  -- ═══ 3. Validate shipped_quantity coherence ═══
  IF EXISTS (
    SELECT 1 FROM commande_lines
    WHERE commande_id = p_commande_id
      AND line_status IN ('ok', 'modifie')
      AND (shipped_quantity IS NULL OR shipped_quantity < 0)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_shipped_quantity');
  END IF;

  IF EXISTS (
    SELECT 1 FROM commande_lines
    WHERE commande_id = p_commande_id
      AND line_status = 'rupture'
      AND COALESCE(shipped_quantity, 0) != 0
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rupture_quantity_must_be_zero');
  END IF;

  -- ═══ 4. Update commande status ═══
  UPDATE commandes
  SET status = 'expediee',
      shipped_by = p_user_id::text,
      shipped_at = now(),
      updated_at = now()
  WHERE id = p_commande_id;

  -- ═══ 5. Stock ledger — WITHDRAWAL from supplier ═══
  -- Get supplier establishment info
  SELECT e.id, e.organization_id INTO v_supplier_est
  FROM establishments e
  WHERE e.id = v_commande.supplier_establishment_id;

  IF v_supplier_est IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'supplier_establishment_not_found');
  END IF;

  v_org_id := v_supplier_est.organization_id;

  -- Idempotency key = ship:{commande_id}
  v_idemp_key := 'ship:' || p_commande_id::text;

  -- Find the first valid storage zone from supplier products
  -- We need to create one doc per zone, but for simplicity we'll group by zone
  -- First: get all supplier products with their zones
  -- Create temp table with supplier product mappings
  CREATE TEMP TABLE _ship_lines ON COMMIT DROP AS
  SELECT
    cl.id as line_id,
    cl.shipped_quantity,
    cl.line_status,
    cl.canonical_unit_id,
    bip.source_product_id as supplier_product_id,
    sp.storage_zone_id as supplier_zone_id,
    sp.nom_produit as supplier_product_name,
    mu.family as canonical_family,
    mu.name as canonical_label
  FROM commande_lines cl
  JOIN b2b_imported_products bip
    ON bip.local_product_id = cl.product_id
    AND bip.establishment_id = v_commande.client_establishment_id
    AND bip.source_establishment_id = v_commande.supplier_establishment_id
  JOIN products_v2 sp ON sp.id = bip.source_product_id
  LEFT JOIN measurement_units mu ON mu.id = cl.canonical_unit_id
  WHERE cl.commande_id = p_commande_id
    AND cl.line_status IN ('ok', 'modifie')
    AND cl.shipped_quantity > 0;

  -- Only proceed with stock if there are lines to ship
  IF EXISTS (SELECT 1 FROM _ship_lines) THEN
    -- Get the first zone (all products should be in same zone ideally, but handle per-zone)
    FOR v_zone_id IN SELECT DISTINCT supplier_zone_id FROM _ship_lines WHERE supplier_zone_id IS NOT NULL
    LOOP
      -- Check snapshot exists for this zone
      IF NOT EXISTS (
        SELECT 1 FROM zone_stock_snapshots
        WHERE establishment_id = v_commande.supplier_establishment_id
          AND storage_zone_id = v_zone_id
      ) THEN
        -- Skip zones without snapshots (stock not initialized)
        CONTINUE;
      END IF;

      v_doc_id := gen_random_uuid();

      -- Create stock document (DRAFT)
      INSERT INTO stock_documents (
        id, establishment_id, organization_id, storage_zone_id,
        type, status, created_by, idempotency_key, source_order_id
      ) VALUES (
        v_doc_id, v_commande.supplier_establishment_id, v_org_id, v_zone_id,
        'WITHDRAWAL', 'DRAFT', p_user_id, v_idemp_key || ':' || v_zone_id::text,
        p_commande_id
      );

      -- Create stock document lines (negative delta for withdrawal)
      INSERT INTO stock_document_lines (
        document_id, product_id,
        delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label,
        context_hash
      )
      SELECT
        v_doc_id,
        sl.supplier_product_id,
        -1 * sl.shipped_quantity,
        sl.canonical_unit_id,
        sl.canonical_family,
        sl.canonical_label,
        'auto:' || sl.supplier_product_id::text || ':' || sl.canonical_unit_id::text || ':' || COALESCE(sl.canonical_family, 'null')
      FROM _ship_lines sl
      WHERE sl.supplier_zone_id = v_zone_id;

      -- Post the document atomically
      SELECT public.fn_post_stock_document(
        p_document_id := v_doc_id,
        p_expected_lock_version := 1,
        p_posted_by := p_user_id,
        p_idempotency_key := v_idemp_key || ':' || v_zone_id::text,
        p_event_reason := 'B2B_SHIPMENT',
        p_override_flag := true,
        p_override_reason := 'Expédition commande B2B ' || p_commande_id::text
      ) INTO v_post_result;

      IF NOT (v_post_result->>'ok')::boolean THEN
        RAISE EXCEPTION 'Stock post failed for ship: %', v_post_result::text;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'line_count', v_line_count);
END;
$$;

-- ═══ 5. REWRITE fn_receive_commande with stock ledger ═══

CREATE OR REPLACE FUNCTION public.fn_receive_commande(
  p_commande_id uuid,
  p_lines jsonb,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commande record;
  v_line_input jsonb;
  v_line_count int := 0;
  v_is_complete boolean := true;
  v_line record;
  v_doc_id uuid;
  v_post_result jsonb;
  v_idemp_key text;
  v_client_est record;
  v_org_id uuid;
  v_zone_id uuid;
BEGIN
  -- ═══ 0. Lock commande ═══
  SELECT * INTO v_commande
  FROM commandes
  WHERE id = p_commande_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'commande_not_found');
  END IF;

  IF v_commande.status != 'expediee' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'current', v_commande.status);
  END IF;

  -- ═══ 1. Update lines with received quantities ═══
  FOR v_line_input IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    UPDATE commande_lines
    SET received_quantity = (v_line_input->>'received_quantity')::numeric
    WHERE id = (v_line_input->>'line_id')::uuid
      AND commande_id = p_commande_id;

    v_line_count := v_line_count + 1;
  END LOOP;

  -- ═══ 2. Determine reception type ═══
  FOR v_line IN
    SELECT shipped_quantity, received_quantity
    FROM commande_lines
    WHERE commande_id = p_commande_id
  LOOP
    IF COALESCE(v_line.received_quantity, 0) != COALESCE(v_line.shipped_quantity, 0) THEN
      v_is_complete := false;
      EXIT;
    END IF;
  END LOOP;

  -- ═══ 3. Update commande status ═══
  UPDATE commandes
  SET status = 'recue',
      received_by = p_user_id::text,
      received_at = now(),
      reception_type = CASE WHEN v_is_complete THEN 'complete' ELSE 'partielle' END,
      updated_at = now()
  WHERE id = p_commande_id;

  -- ═══ 4. Stock ledger — RECEIPT to client ═══
  SELECT e.id, e.organization_id INTO v_client_est
  FROM establishments e
  WHERE e.id = v_commande.client_establishment_id;

  IF v_client_est IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'client_establishment_not_found');
  END IF;

  v_org_id := v_client_est.organization_id;
  v_idemp_key := 'receive:' || p_commande_id::text;

  -- Build receipt lines from commande_lines (product_id is already client's product)
  CREATE TEMP TABLE _recv_lines ON COMMIT DROP AS
  SELECT
    cl.id as line_id,
    cl.product_id as client_product_id,
    COALESCE(cl.received_quantity, 0) as received_qty,
    cl.canonical_unit_id,
    cp.storage_zone_id as client_zone_id,
    cp.nom_produit as client_product_name,
    mu.family as canonical_family,
    mu.name as canonical_label
  FROM commande_lines cl
  JOIN products_v2 cp ON cp.id = cl.product_id
  LEFT JOIN measurement_units mu ON mu.id = cl.canonical_unit_id
  WHERE cl.commande_id = p_commande_id
    AND COALESCE(cl.received_quantity, 0) > 0;

  IF EXISTS (SELECT 1 FROM _recv_lines) THEN
    FOR v_zone_id IN SELECT DISTINCT client_zone_id FROM _recv_lines WHERE client_zone_id IS NOT NULL
    LOOP
      -- Check snapshot exists
      IF NOT EXISTS (
        SELECT 1 FROM zone_stock_snapshots
        WHERE establishment_id = v_commande.client_establishment_id
          AND storage_zone_id = v_zone_id
      ) THEN
        CONTINUE;
      END IF;

      v_doc_id := gen_random_uuid();

      INSERT INTO stock_documents (
        id, establishment_id, organization_id, storage_zone_id,
        type, status, created_by, idempotency_key, source_order_id
      ) VALUES (
        v_doc_id, v_commande.client_establishment_id, v_org_id, v_zone_id,
        'RECEIPT', 'DRAFT', p_user_id, v_idemp_key || ':' || v_zone_id::text,
        p_commande_id
      );

      INSERT INTO stock_document_lines (
        document_id, product_id,
        delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label,
        context_hash
      )
      SELECT
        v_doc_id,
        rl.client_product_id,
        rl.received_qty,
        rl.canonical_unit_id,
        rl.canonical_family,
        rl.canonical_label,
        'auto:' || rl.client_product_id::text || ':' || rl.canonical_unit_id::text || ':' || COALESCE(rl.canonical_family, 'null')
      FROM _recv_lines rl
      WHERE rl.client_zone_id = v_zone_id;

      SELECT public.fn_post_stock_document(
        p_document_id := v_doc_id,
        p_expected_lock_version := 1,
        p_posted_by := p_user_id,
        p_idempotency_key := v_idemp_key || ':' || v_zone_id::text,
        p_event_reason := 'B2B_RECEPTION',
        p_override_flag := false
      ) INTO v_post_result;

      IF NOT (v_post_result->>'ok')::boolean THEN
        RAISE EXCEPTION 'Stock post failed for receive: %', v_post_result::text;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'line_count', v_line_count,
    'reception_type', CASE WHEN v_is_complete THEN 'complete' ELSE 'partielle' END
  );
END;
$$;
