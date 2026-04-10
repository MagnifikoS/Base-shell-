
CREATE OR REPLACE FUNCTION public.fn_ship_commande(
  p_commande_id uuid,
  p_user_id uuid,
  p_lines jsonb
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
  SELECT e.id, e.organization_id INTO v_supplier_est
  FROM establishments e
  WHERE e.id = v_commande.supplier_establishment_id;

  IF v_supplier_est IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'supplier_establishment_not_found');
  END IF;

  v_org_id := v_supplier_est.organization_id;
  v_idemp_key := 'ship:' || p_commande_id::text;

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

  IF EXISTS (SELECT 1 FROM _ship_lines) THEN
    FOR v_zone_id IN SELECT DISTINCT supplier_zone_id FROM _ship_lines WHERE supplier_zone_id IS NOT NULL
    LOOP
      -- ══ AUTO-BOOTSTRAP: create snapshot at qty=0 if missing ══
      IF NOT EXISTS (
        SELECT 1 FROM zone_stock_snapshots
        WHERE establishment_id = v_commande.supplier_establishment_id
          AND storage_zone_id = v_zone_id
      ) THEN
        INSERT INTO zone_stock_snapshots (
          establishment_id, storage_zone_id, snapshot_version_id
        ) VALUES (
          v_commande.supplier_establishment_id,
          v_zone_id,
          gen_random_uuid()
        );

        -- Bootstrap inventory_lines at qty=0 for each product in this zone
        INSERT INTO inventory_lines (
          session_id, product_id, quantity, unit_id, display_order, created_via
        )
        SELECT
          (SELECT snapshot_version_id FROM zone_stock_snapshots
           WHERE establishment_id = v_commande.supplier_establishment_id
             AND storage_zone_id = v_zone_id),
          sl.supplier_product_id,
          0,
          sl.canonical_unit_id,
          0,
          'INIT_AFTER_SNAPSHOT'
        FROM _ship_lines sl
        WHERE sl.supplier_zone_id = v_zone_id
        ON CONFLICT DO NOTHING;
      END IF;

      v_doc_id := gen_random_uuid();

      INSERT INTO stock_documents (
        id, establishment_id, organization_id, storage_zone_id,
        type, status, created_by, idempotency_key, source_order_id
      ) VALUES (
        v_doc_id, v_commande.supplier_establishment_id, v_org_id, v_zone_id,
        'WITHDRAWAL', 'DRAFT', p_user_id, v_idemp_key || ':' || v_zone_id::text,
        p_commande_id
      );

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

      SELECT public.fn_post_stock_document(
        p_document_id := v_doc_id,
        p_expected_lock_version := 1,
        p_posted_by := p_user_id,
        p_idempotency_key := v_idemp_key || ':' || v_zone_id::text,
        p_event_reason := 'B2B_SHIPMENT',
        p_override_flag := true,
        p_override_reason := 'Expedition commande B2B ' || p_commande_id::text
      ) INTO v_post_result;

      IF NOT (v_post_result->>'ok')::boolean THEN
        RAISE EXCEPTION 'Stock post failed for ship: %', v_post_result::text;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'line_count', v_line_count);
END;
$$;
