CREATE OR REPLACE FUNCTION public.fn_ship_commande(
  p_commande_id uuid, 
  p_user_id uuid, 
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_commande record;
  v_line_count int := 0;
  v_clamped_count int := 0;
  v_conversion_error_count int := 0;
  v_doc_id uuid;
  v_idemp_key text;
  v_supplier_est record;
  v_org_id uuid;
  v_zone_id uuid;
  v_bootstrap_session_id uuid;
  v_post_result jsonb;
BEGIN
  -- ═══ 0. Lock + status guard (= idempotence V1) ═══
  SELECT * INTO v_commande
  FROM commandes WHERE id = p_commande_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'commande_not_found');
  END IF;
  IF v_commande.status != 'ouverte' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'current', v_commande.status);
  END IF;

  -- ═══ 1. Resolve supplier ═══
  SELECT e.id, e.organization_id INTO v_supplier_est
  FROM establishments e WHERE e.id = v_commande.supplier_establishment_id;
  IF v_supplier_est IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'supplier_establishment_not_found');
  END IF;
  v_org_id := v_supplier_est.organization_id;
  v_idemp_key := 'ship:' || p_commande_id::text;

  -- ═══ 2. Build _ship_lines — DISTINCT ON for BIP safety ═══
  CREATE TEMP TABLE _ship_lines ON COMMIT DROP AS
  SELECT DISTINCT ON (cl.id)
    cl.id AS line_id,
    cl.canonical_quantity AS ordered_qty,
    LEAST(GREATEST((li.value->>'shipped_quantity')::numeric, 0), cl.canonical_quantity) AS client_shipped_qty,
    cl.canonical_unit_id AS client_unit_id,
    bip.source_product_id AS supplier_product_id,
    sp.storage_zone_id AS supplier_zone_id,
    sp.nom_produit AS supplier_product_name,
    conv.supplier_unit_id,
    conv.supplier_quantity,
    conv.supplier_family,
    conv.status AS conversion_status,
    CASE 
      WHEN conv.supplier_quantity IS NOT NULL AND conv.supplier_quantity != 0 
      THEN LEAST(GREATEST((li.value->>'shipped_quantity')::numeric, 0), cl.canonical_quantity) / conv.supplier_quantity
      ELSE NULL 
    END AS conversion_factor
  FROM jsonb_array_elements(p_lines) li(value)
  JOIN commande_lines cl 
    ON cl.id = (li.value->>'line_id')::uuid 
    AND cl.commande_id = p_commande_id
  JOIN b2b_imported_products bip
    ON bip.local_product_id = cl.product_id
    AND bip.establishment_id = v_commande.client_establishment_id
    AND bip.source_establishment_id = v_commande.supplier_establishment_id
  JOIN products_v2 sp ON sp.id = bip.source_product_id
  CROSS JOIN LATERAL fn_convert_b2b_quantity(
    bip.source_product_id, 
    cl.canonical_unit_id, 
    LEAST(GREATEST((li.value->>'shipped_quantity')::numeric, 0), cl.canonical_quantity)
  ) AS conv
  ORDER BY cl.id, bip.imported_at DESC;

  v_line_count := (SELECT count(*) FROM _ship_lines);

  -- ═══ 2b. Count conversion errors ═══
  SELECT count(*) INTO v_conversion_error_count
  FROM _ship_lines WHERE conversion_status = 'error';

  -- ═══ 2c. Add supplier unit label ═══
  ALTER TABLE _ship_lines ADD COLUMN supplier_unit_label text;
  UPDATE _ship_lines sl
  SET supplier_unit_label = mu.name
  FROM measurement_units mu
  WHERE mu.id = sl.supplier_unit_id;

  -- ═══ 3. Per zone: DRAFT → lines → fn_post_stock_document → read effective → write ONCE ═══
  FOR v_zone_id IN 
    SELECT DISTINCT supplier_zone_id FROM _ship_lines 
    WHERE supplier_zone_id IS NOT NULL AND conversion_status != 'error'
      AND client_shipped_qty > 0
  LOOP
    -- ── 3a. Bootstrap snapshot if needed ──
    IF NOT EXISTS (
      SELECT 1 FROM zone_stock_snapshots
      WHERE establishment_id = v_commande.supplier_establishment_id AND storage_zone_id = v_zone_id
    ) THEN
      v_bootstrap_session_id := gen_random_uuid();
      INSERT INTO inventory_sessions (
        id, establishment_id, organization_id, storage_zone_id,
        started_by, started_at, status, completed_at, total_products, counted_products
      ) VALUES (
        v_bootstrap_session_id,
        v_commande.supplier_establishment_id, v_org_id, v_zone_id,
        p_user_id, now(), 'termine', now(), 0, 0
      );
      INSERT INTO zone_stock_snapshots (
        establishment_id, organization_id, storage_zone_id, snapshot_version_id, activated_by
      ) VALUES (
        v_commande.supplier_establishment_id, v_org_id, v_zone_id, v_bootstrap_session_id, p_user_id
      );
      INSERT INTO inventory_lines (session_id, product_id, quantity, unit_id, display_order, created_via)
      SELECT v_bootstrap_session_id, sl.supplier_product_id, 0, sl.supplier_unit_id, 0, 'INIT_AFTER_SNAPSHOT'
      FROM _ship_lines sl WHERE sl.supplier_zone_id = v_zone_id AND sl.conversion_status != 'error'
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── 3b. Create stock_document as DRAFT ──
    v_doc_id := gen_random_uuid();
    INSERT INTO stock_documents (
      id, establishment_id, organization_id, storage_zone_id,
      type, status, created_by, source_order_id, lock_version
    ) VALUES (
      v_doc_id, v_commande.supplier_establishment_id, v_org_id, v_zone_id,
      'WITHDRAWAL', 'DRAFT', p_user_id, p_commande_id, 1
    );

    -- ── 3c. Insert stock_document_lines with traceability ──
    INSERT INTO stock_document_lines (
      document_id, product_id, delta_quantity_canonical, canonical_unit_id, 
      canonical_family, canonical_label, context_hash,
      source_line_id, conversion_factor, client_unit_id, supplier_unit_id
    )
    SELECT 
      v_doc_id, 
      sl.supplier_product_id,
      -1 * sl.supplier_quantity,
      sl.supplier_unit_id,
      sl.supplier_family,
      COALESCE(sl.supplier_unit_label, ''),
      'b2b_ship:' || sl.supplier_product_id::text || ':' || sl.supplier_unit_id::text,
      sl.line_id,
      sl.conversion_factor,
      sl.client_unit_id,
      sl.supplier_unit_id
    FROM _ship_lines sl 
    WHERE sl.supplier_zone_id = v_zone_id 
      AND sl.conversion_status != 'error'
      AND sl.client_shipped_qty > 0;

    -- ── 3d. Call fn_post_stock_document ──
    v_post_result := fn_post_stock_document(
      p_document_id := v_doc_id,
      p_expected_lock_version := 1,
      p_posted_by := p_user_id,
      p_idempotency_key := v_idemp_key || ':' || v_zone_id::text,
      p_event_reason := 'B2B_SHIPMENT'
    );

    IF NOT (v_post_result->>'ok')::boolean THEN
      RAISE EXCEPTION 'STOCK_POST_FAILED: %', v_post_result::text;
    END IF;

    v_clamped_count := v_clamped_count + COALESCE((v_post_result->>'clamped_count')::int, 0);

    -- ── 3e. Read effective → back-convert → write shipped_qty + line_status ONCE ──
    UPDATE commande_lines cl
    SET 
      shipped_quantity = CASE
        WHEN se.delta_quantity_canonical IS NOT NULL AND sl.conversion_factor IS NOT NULL AND sl.conversion_factor != 0
          THEN ROUND(ABS(se.delta_quantity_canonical) * sl.conversion_factor, 4)
        WHEN se.delta_quantity_canonical IS NOT NULL 
          THEN ROUND(ABS(se.delta_quantity_canonical), 4)
        ELSE 0
      END,
      line_status = CASE
        WHEN se.delta_quantity_canonical IS NULL OR ROUND(ABS(COALESCE(se.delta_quantity_canonical, 0)), 4) = 0 
          THEN 'rupture'
        WHEN ROUND(ABS(se.delta_quantity_canonical), 4) < ROUND(sl.supplier_quantity, 4)
          THEN 'modifie'
        ELSE 'ok'
      END
    FROM _ship_lines sl
    LEFT JOIN stock_events se 
      ON se.document_id = v_doc_id 
      AND se.product_id = sl.supplier_product_id
    WHERE cl.id = sl.line_id
      AND sl.supplier_zone_id = v_zone_id
      AND sl.conversion_status != 'error'
      AND sl.client_shipped_qty > 0;

  END LOOP;

  -- ═══ 4. Conversion errors + zero input → rupture ═══
  UPDATE commande_lines cl
  SET shipped_quantity = 0, line_status = 'rupture'
  FROM _ship_lines sl
  WHERE sl.line_id = cl.id 
    AND (sl.conversion_status = 'error' OR sl.client_shipped_qty = 0);

  -- ═══ 5. Validate all lines processed ═══
  IF EXISTS (
    SELECT 1 FROM commande_lines 
    WHERE commande_id = p_commande_id AND line_status IS NULL
  ) THEN
    RAISE EXCEPTION 'LINES_NOT_ALL_PROCESSED: Some lines have no status after shipment';
  END IF;

  -- ═══ 6. Transition commande status ═══
  UPDATE commandes
  SET status = 'expediee', shipped_by = p_user_id::text, shipped_at = now(), updated_at = now()
  WHERE id = p_commande_id;

  RETURN jsonb_build_object(
    'ok', true, 
    'line_count', v_line_count, 
    'clamped_count', v_clamped_count, 
    'conversion_errors', v_conversion_error_count
  );
END;
$function$;