
-- Fix Step 5: replace broken snapshot-based stock reading with reliable SUM(all events)
-- Only the member_stock CTE changes. Everything else is identical.

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
  v_err_line record;
BEGIN
  -- ═══ 0. Lock + status guard ═══
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

  -- ═══ 2. Build _ship_lines ═══
  CREATE TEMP TABLE _ship_lines ON COMMIT DROP AS
  SELECT DISTINCT ON (cl.id)
    cl.id AS line_id,
    cl.canonical_quantity AS ordered_qty,
    LEAST(GREATEST((li.value->>'shipped_quantity')::numeric, 0), cl.canonical_quantity) AS client_shipped_qty,
    cl.canonical_unit_id AS client_unit_id,
    bip.source_product_id AS carrier_product_id,
    sp.nom_produit AS supplier_product_name,
    sp.storage_zone_id AS carrier_zone_id,
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

  -- ═══ 2b. Conversion errors ═══
  SELECT count(*) INTO v_conversion_error_count
  FROM _ship_lines WHERE conversion_status = 'error';
  IF v_conversion_error_count > 0 THEN
    FOR v_err_line IN SELECT * FROM _ship_lines WHERE conversion_status = 'error' LOOP
      INSERT INTO brain_events (establishment_id, action, subject, context)
      VALUES (
        v_commande.supplier_establishment_id, 'b2b_conversion_error', 'fn_ship_commande',
        jsonb_build_object('commande_id', p_commande_id, 'line_id', v_err_line.line_id,
          'product_id', v_err_line.carrier_product_id, 'client_unit_id', v_err_line.client_unit_id, 'context', 'shipment')
      );
    END LOOP;
  END IF;

  -- ═══ 2c. Supplier unit label ═══
  ALTER TABLE _ship_lines ADD COLUMN supplier_unit_label text;
  UPDATE _ship_lines sl SET supplier_unit_label = mu.name
  FROM measurement_units mu WHERE mu.id = sl.supplier_unit_id;

  -- ═══════════════════════════════════════════════════════════════
  -- ═══ 3. MUTUALIZED ALLOCATION (WITH RECURSIVE) ═══
  -- ═══════════════════════════════════════════════════════════════
  CREATE TEMP TABLE _allocation_lines ON COMMIT DROP AS
  WITH RECURSIVE
  group_members_raw AS (
    SELECT sl.line_id, sl.client_shipped_qty,
      sl.supplier_quantity AS total_supplier_qty, sl.supplier_unit_id,
      sl.supplier_family, sl.conversion_status, sl.conversion_factor,
      sl.carrier_product_id, sl.carrier_zone_id,
      gm.member_product_id, gm.is_mutualized, gm.group_id
    FROM _ship_lines sl
    CROSS JOIN LATERAL fn_get_group_members(sl.carrier_product_id, v_commande.supplier_establishment_id) gm
    WHERE sl.conversion_status != 'error' AND sl.client_shipped_qty > 0
  ),
  group_coherence AS (
    SELECT gmr.group_id, COUNT(DISTINCT mu.category) <= 1 AS is_coherent
    FROM group_members_raw gmr
    JOIN products_v2 mp ON mp.id = gmr.member_product_id
    LEFT JOIN measurement_units mu ON mu.id = mp.final_unit_id
    WHERE gmr.group_id IS NOT NULL
    GROUP BY gmr.group_id
  ),
  group_members_filtered AS (
    SELECT gmr.*, mp.storage_zone_id AS member_zone_id, mp.nom_produit AS member_product_name
    FROM group_members_raw gmr
    JOIN products_v2 mp ON mp.id = gmr.member_product_id
    LEFT JOIN group_coherence gc ON gc.group_id = gmr.group_id
    WHERE NOT gmr.is_mutualized
      OR (gmr.is_mutualized AND COALESCE(gc.is_coherent, false))
      OR (gmr.is_mutualized AND NOT COALESCE(gc.is_coherent, false) AND gmr.member_product_id = gmr.carrier_product_id)
  ),
  -- ══════════════════════════════════════════════════════════
  -- FIX: Use SUM(ALL stock_events) instead of broken snapshot join
  -- This gives the true physical stock for each member product.
  -- The old approach filtered by active snapshot_version_id which
  -- returned near-zero because most events were under older snapshots.
  -- ══════════════════════════════════════════════════════════
  member_stock AS (
    SELECT gmf.*,
      GREATEST(
        COALESCE(stock_total.total_stock, 0),
        0
      ) AS available_stock
    FROM group_members_filtered gmf
    LEFT JOIN LATERAL (
      SELECT SUM(se.delta_quantity_canonical) AS total_stock
      FROM stock_events se
      WHERE se.product_id = gmf.member_product_id
        AND se.establishment_id = v_commande.supplier_establishment_id
    ) stock_total ON true
  ),
  ranked_members AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY line_id ORDER BY available_stock DESC, member_product_id) AS rn
    FROM member_stock
  ),
  allocation_recursive AS (
    -- Base: rank 1 (highest stock)
    SELECT rm.line_id, rm.member_product_id, rm.member_zone_id, rm.member_product_name,
      rm.supplier_unit_id, rm.supplier_family, rm.conversion_factor,
      rm.rn, rm.available_stock, rm.total_supplier_qty,
      LEAST(rm.available_stock, rm.total_supplier_qty) AS allocated,
      rm.total_supplier_qty - LEAST(rm.available_stock, rm.total_supplier_qty) AS remaining
    FROM ranked_members rm WHERE rm.rn = 1
    UNION ALL
    -- Recursive: rank N consumes remaining from N-1
    SELECT rm.line_id, rm.member_product_id, rm.member_zone_id, rm.member_product_name,
      rm.supplier_unit_id, rm.supplier_family, rm.conversion_factor,
      rm.rn, rm.available_stock, rm.total_supplier_qty,
      LEAST(rm.available_stock, ar.remaining) AS allocated,
      ar.remaining - LEAST(rm.available_stock, ar.remaining) AS remaining
    FROM allocation_recursive ar
    JOIN ranked_members rm ON rm.line_id = ar.line_id AND rm.rn = ar.rn + 1
    WHERE ar.remaining > 0
  )
  SELECT ar.line_id, ar.member_product_id, ar.member_zone_id, ar.member_product_name,
    ar.supplier_unit_id, ar.supplier_family, ar.conversion_factor,
    ar.allocated AS allocated_qty
  FROM allocation_recursive ar;

  -- ═══ 4. Per-zone stock documents ═══
  FOR v_zone_id IN SELECT DISTINCT member_zone_id FROM _allocation_lines WHERE allocated_qty > 0 LOOP
    IF NOT EXISTS (
      SELECT 1 FROM zone_stock_snapshots
      WHERE storage_zone_id = v_zone_id AND establishment_id = v_commande.supplier_establishment_id
    ) THEN
      v_bootstrap_session_id := gen_random_uuid();
      INSERT INTO inventory_sessions (id, establishment_id, organization_id, storage_zone_id,
        created_by, started_at, status, completed_at, counted_products, total_products)
      VALUES (v_bootstrap_session_id, v_commande.supplier_establishment_id, v_org_id, v_zone_id,
        p_user_id, now(), 'termine', now(), 0, 0);
      INSERT INTO zone_stock_snapshots (establishment_id, organization_id, storage_zone_id, snapshot_version_id, activated_by)
      VALUES (v_commande.supplier_establishment_id, v_org_id, v_zone_id, v_bootstrap_session_id, p_user_id);
      INSERT INTO inventory_lines (session_id, product_id, quantity, unit_id, display_order, created_via)
      SELECT v_bootstrap_session_id, al.member_product_id, 0, al.supplier_unit_id, 0, 'INIT_AFTER_SNAPSHOT'
      FROM _allocation_lines al WHERE al.member_zone_id = v_zone_id ON CONFLICT DO NOTHING;
    END IF;

    v_doc_id := gen_random_uuid();
    INSERT INTO stock_documents (id, establishment_id, organization_id, storage_zone_id,
      type, status, created_by, source_order_id, lock_version)
    VALUES (v_doc_id, v_commande.supplier_establishment_id, v_org_id, v_zone_id,
      'WITHDRAWAL', 'DRAFT', p_user_id, p_commande_id, 1);

    INSERT INTO stock_document_lines (document_id, product_id, delta_quantity_canonical, canonical_unit_id,
      canonical_family, canonical_label, context_hash, source_line_id, conversion_factor, client_unit_id, supplier_unit_id)
    SELECT v_doc_id, al.member_product_id, -1 * al.allocated_qty, al.supplier_unit_id,
      al.supplier_family, COALESCE(mu.name, ''),
      'b2b_ship:' || al.member_product_id::text || ':' || al.supplier_unit_id::text,
      al.line_id, al.conversion_factor, sl.client_unit_id, al.supplier_unit_id
    FROM _allocation_lines al
    JOIN _ship_lines sl ON sl.line_id = al.line_id
    LEFT JOIN measurement_units mu ON mu.id = al.supplier_unit_id
    WHERE al.member_zone_id = v_zone_id AND al.allocated_qty > 0;

    v_post_result := fn_post_stock_document(
      p_document_id := v_doc_id, p_expected_lock_version := 1,
      p_posted_by := p_user_id,
      p_idempotency_key := v_idemp_key || ':' || v_zone_id::text,
      p_event_reason := 'B2B_SHIPMENT');
    IF NOT (v_post_result->>'ok')::boolean THEN
      RAISE EXCEPTION 'STOCK_POST_FAILED: %', v_post_result::text;
    END IF;
    v_clamped_count := v_clamped_count + COALESCE((v_post_result->>'clamped_count')::int, 0);
  END LOOP;

  -- ═══ 5. Write shipped_qty + line_status ═══
  UPDATE commande_lines cl
  SET
    shipped_quantity = CASE
      WHEN alloc_sum.total_effective IS NOT NULL AND sl.conversion_factor IS NOT NULL AND sl.conversion_factor != 0
        THEN ROUND(alloc_sum.total_effective * sl.conversion_factor, 4)
      WHEN alloc_sum.total_effective IS NOT NULL
        THEN ROUND(alloc_sum.total_effective, 4)
      ELSE 0
    END,
    line_status = CASE
      WHEN alloc_sum.total_effective IS NULL OR ROUND(COALESCE(alloc_sum.total_effective, 0), 4) = 0 THEN 'rupture'
      WHEN ROUND(alloc_sum.total_effective, 4) < ROUND(sl.supplier_quantity, 4) THEN 'modifie'
      ELSE 'ok'
    END
  FROM _ship_lines sl
  LEFT JOIN (
    SELECT al.line_id,
      SUM(COALESCE(
        (SELECT ABS(se.delta_quantity_canonical)
         FROM stock_events se JOIN stock_documents sd ON sd.id = se.document_id
         WHERE se.product_id = al.member_product_id AND se.storage_zone_id = al.member_zone_id
           AND sd.source_order_id = p_commande_id AND se.event_reason = 'B2B_SHIPMENT'
         ORDER BY se.posted_at DESC LIMIT 1), 0)
    ) AS total_effective
    FROM _allocation_lines al WHERE al.allocated_qty > 0 GROUP BY al.line_id
  ) alloc_sum ON alloc_sum.line_id = sl.line_id
  WHERE cl.id = sl.line_id AND sl.conversion_status != 'error' AND sl.client_shipped_qty > 0;

  -- ═══ 6. Conversion errors / zero → rupture ═══
  UPDATE commande_lines cl SET shipped_quantity = 0, line_status = 'rupture'
  FROM _ship_lines sl WHERE sl.line_id = cl.id AND (sl.conversion_status = 'error' OR sl.client_shipped_qty = 0);

  -- ═══ 7. Validate ═══
  IF EXISTS (SELECT 1 FROM commande_lines WHERE commande_id = p_commande_id AND line_status IS NULL) THEN
    RAISE EXCEPTION 'LINES_NOT_ALL_PROCESSED';
  END IF;

  -- ═══ 8. Transition ═══
  UPDATE commandes SET status = 'expediee', shipped_by = p_user_id::text, shipped_at = now(), updated_at = now()
  WHERE id = p_commande_id;

  RETURN jsonb_build_object('ok', true, 'line_count', v_line_count,
    'clamped_count', v_clamped_count, 'conversion_errors', v_conversion_error_count);
END;
$function$;
