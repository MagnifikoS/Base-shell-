
-- ═══════════════════════════════════════════════════════════════════════
-- ÉTAPE 5 FIX: Add coherence check to prevent incoherent group allocation
-- 
-- The _allocation_lines CTE must filter out incoherent groups and 
-- fall back to single-product behavior (only the carrier itself).
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_ship_commande(
  p_commande_id UUID,
  p_user_id UUID,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- ═══ 2. Build _ship_lines — resolve source product via BIP ═══
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

  -- ═══ 2b. Count conversion errors ═══
  SELECT count(*) INTO v_conversion_error_count
  FROM _ship_lines WHERE conversion_status = 'error';

  IF v_conversion_error_count > 0 THEN
    FOR v_err_line IN 
      SELECT carrier_product_id, client_unit_id 
      FROM _ship_lines WHERE conversion_status = 'error'
    LOOP
      PERFORM fn_log_conversion_error(
        v_commande.supplier_establishment_id,
        v_err_line.carrier_product_id,
        v_err_line.client_unit_id,
        'shipment'
      );
    END LOOP;
  END IF;

  -- ═══ 2c. Add supplier unit label ═══
  ALTER TABLE _ship_lines ADD COLUMN supplier_unit_label text;
  UPDATE _ship_lines sl
  SET supplier_unit_label = mu.name
  FROM measurement_units mu
  WHERE mu.id = sl.supplier_unit_id;

  -- ═══════════════════════════════════════════════════════════════
  -- ═══ 3. MUTUALIZED ALLOCATION ═══
  -- 
  -- For each line:
  -- 1. Get all group members via fn_get_group_members
  -- 2. CHECK COHERENCE: if members have different unit categories → 
  --    fall back to carrier only (no multi-member allocation)
  -- 3. For coherent groups: sort by stock DESC, allocate sequentially
  -- ═══════════════════════════════════════════════════════════════

  CREATE TEMP TABLE _allocation_lines ON COMMIT DROP AS
  WITH group_members_raw AS (
    -- For each ship line, get all group members
    SELECT
      sl.line_id,
      sl.client_shipped_qty,
      sl.supplier_quantity AS total_supplier_qty,
      sl.supplier_unit_id,
      sl.supplier_family,
      sl.conversion_status,
      sl.conversion_factor,
      sl.carrier_product_id,
      sl.carrier_zone_id,
      gm.member_product_id,
      gm.is_mutualized,
      gm.group_id
    FROM _ship_lines sl
    CROSS JOIN LATERAL fn_get_group_members(sl.carrier_product_id, v_commande.supplier_establishment_id) gm
    WHERE sl.conversion_status != 'error'
      AND sl.client_shipped_qty > 0
  ),
  -- Check coherence per group: all members must have same unit category
  group_coherence AS (
    SELECT DISTINCT gmr.group_id,
      (COUNT(DISTINCT mu.category) OVER (PARTITION BY gmr.group_id)) <= 1 AS is_coherent
    FROM group_members_raw gmr
    JOIN products_v2 mp ON mp.id = gmr.member_product_id
    LEFT JOIN measurement_units mu ON mu.id = mp.final_unit_id
    WHERE gmr.group_id IS NOT NULL
  ),
  group_members_filtered AS (
    -- For coherent groups: use all members
    -- For incoherent groups: use ONLY the carrier (safe fallback)
    -- For non-grouped products: use the product itself (is_mutualized=false)
    SELECT gmr.*,
      mp.storage_zone_id AS member_zone_id,
      mp.nom_produit AS member_product_name
    FROM group_members_raw gmr
    JOIN products_v2 mp ON mp.id = gmr.member_product_id
    LEFT JOIN group_coherence gc ON gc.group_id = gmr.group_id
    WHERE
      -- Non-mutualized: always include (virtual group of 1)
      NOT gmr.is_mutualized
      -- Coherent group: include all members
      OR (gmr.is_mutualized AND COALESCE(gc.is_coherent, false))
      -- Incoherent group: include ONLY the carrier
      OR (gmr.is_mutualized AND NOT COALESCE(gc.is_coherent, false) AND gmr.member_product_id = gmr.carrier_product_id)
  ),
  member_stock AS (
    SELECT
      gmf.*,
      GREATEST(
        COALESCE(il.quantity, 0) + COALESCE(SUM(se.delta_quantity_canonical), 0),
        0
      ) AS available_stock
    FROM group_members_filtered gmf
    LEFT JOIN zone_stock_snapshots zss 
      ON zss.storage_zone_id = gmf.member_zone_id
      AND zss.establishment_id = v_commande.supplier_establishment_id
    LEFT JOIN inventory_lines il 
      ON il.session_id = zss.snapshot_version_id 
      AND il.product_id = gmf.member_product_id
    LEFT JOIN stock_events se 
      ON se.product_id = gmf.member_product_id 
      AND se.storage_zone_id = gmf.member_zone_id
      AND se.snapshot_version_id = zss.snapshot_version_id
      AND se.canonical_family = gmf.supplier_family
    GROUP BY gmf.line_id, gmf.client_shipped_qty, gmf.total_supplier_qty, 
             gmf.supplier_unit_id, gmf.supplier_family, gmf.conversion_status,
             gmf.conversion_factor, gmf.carrier_product_id, gmf.carrier_zone_id,
             gmf.member_product_id, gmf.is_mutualized, gmf.group_id,
             gmf.member_zone_id, gmf.member_product_name,
             il.quantity
  ),
  ranked_members AS (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY line_id ORDER BY available_stock DESC, member_product_id) AS rn
    FROM member_stock
  ),
  -- Sequential allocation using a self-join approach
  -- For each member at rank N, sum what was allocated to ranks 1..N-1
  allocation_calc AS (
    SELECT
      rm.line_id,
      rm.member_product_id,
      rm.member_zone_id,
      rm.member_product_name,
      rm.supplier_unit_id,
      rm.supplier_family,
      rm.conversion_factor,
      rm.rn,
      rm.available_stock,
      rm.total_supplier_qty,
      -- Sum allocated to all previous ranks
      COALESCE((
        SELECT SUM(LEAST(prev.available_stock, GREATEST(prev.total_supplier_qty - COALESCE((
          SELECT SUM(LEAST(pp.available_stock, GREATEST(pp.total_supplier_qty - COALESCE((
            SELECT SUM(LEAST(ppp.available_stock, ppp.total_supplier_qty))
            FROM ranked_members ppp WHERE ppp.line_id = pp.line_id AND ppp.rn < pp.rn
          ), 0), 0)))
          FROM ranked_members pp WHERE pp.line_id = prev.line_id AND pp.rn < prev.rn
        ), 0), 0)))
        FROM ranked_members prev WHERE prev.line_id = rm.line_id AND prev.rn < rm.rn
      ), 0) AS prior_allocated
    FROM ranked_members rm
  )
  SELECT
    ac.line_id,
    ac.member_product_id,
    ac.member_zone_id,
    ac.member_product_name,
    ac.supplier_unit_id,
    ac.supplier_family,
    ac.conversion_factor,
    -- This member's allocation = min(available, remaining)
    LEAST(
      ac.available_stock,
      GREATEST(ac.total_supplier_qty - ac.prior_allocated, 0)
    ) AS allocated_qty
  FROM allocation_calc ac;

  -- ═══ 4. Per zone: DRAFT → lines → fn_post_stock_document ═══
  FOR v_zone_id IN 
    SELECT DISTINCT member_zone_id FROM _allocation_lines 
    WHERE member_zone_id IS NOT NULL AND allocated_qty > 0
  LOOP
    -- ── 4a. Bootstrap snapshot if needed ──
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
      SELECT v_bootstrap_session_id, al.member_product_id, 0, al.supplier_unit_id, 0, 'INIT_AFTER_SNAPSHOT'
      FROM _allocation_lines al WHERE al.member_zone_id = v_zone_id
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── 4b. Create stock_document as DRAFT ──
    v_doc_id := gen_random_uuid();
    INSERT INTO stock_documents (
      id, establishment_id, organization_id, storage_zone_id,
      type, status, created_by, source_order_id, lock_version
    ) VALUES (
      v_doc_id, v_commande.supplier_establishment_id, v_org_id, v_zone_id,
      'WITHDRAWAL', 'DRAFT', p_user_id, p_commande_id, 1
    );

    -- ── 4c. Insert stock_document_lines for each allocated member ──
    INSERT INTO stock_document_lines (
      document_id, product_id, delta_quantity_canonical, canonical_unit_id, 
      canonical_family, canonical_label, context_hash,
      source_line_id, conversion_factor, client_unit_id, supplier_unit_id
    )
    SELECT 
      v_doc_id, 
      al.member_product_id,
      -1 * al.allocated_qty,
      al.supplier_unit_id,
      al.supplier_family,
      COALESCE(mu.name, ''),
      'b2b_ship:' || al.member_product_id::text || ':' || al.supplier_unit_id::text,
      al.line_id,
      al.conversion_factor,
      sl.client_unit_id,
      al.supplier_unit_id
    FROM _allocation_lines al
    JOIN _ship_lines sl ON sl.line_id = al.line_id
    LEFT JOIN measurement_units mu ON mu.id = al.supplier_unit_id
    WHERE al.member_zone_id = v_zone_id 
      AND al.allocated_qty > 0;

    -- ── 4d. Call fn_post_stock_document ──
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
  END LOOP;

  -- ═══ 5. Write shipped_qty + line_status ONCE per commande_line ═══
  -- Sum actual stock_events (post-clamp) across all members for each line
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
      WHEN alloc_sum.total_effective IS NULL OR ROUND(COALESCE(alloc_sum.total_effective, 0), 4) = 0 
        THEN 'rupture'
      WHEN ROUND(alloc_sum.total_effective, 4) < ROUND(sl.supplier_quantity, 4)
        THEN 'modifie'
      ELSE 'ok'
    END
  FROM _ship_lines sl
  LEFT JOIN (
    SELECT al.line_id, 
      SUM(COALESCE(
        (SELECT ABS(se.delta_quantity_canonical) 
         FROM stock_events se 
         JOIN stock_documents sd ON sd.id = se.document_id
         WHERE se.product_id = al.member_product_id
           AND se.storage_zone_id = al.member_zone_id
           AND sd.source_order_id = p_commande_id
           AND se.event_reason = 'B2B_SHIPMENT'
         ORDER BY se.posted_at DESC
         LIMIT 1
        ), 0)
    ) AS total_effective
    FROM _allocation_lines al
    WHERE al.allocated_qty > 0
    GROUP BY al.line_id
  ) alloc_sum ON alloc_sum.line_id = sl.line_id
  WHERE cl.id = sl.line_id
    AND sl.conversion_status != 'error'
    AND sl.client_shipped_qty > 0;

  -- ═══ 6. Conversion errors + zero input → rupture ═══
  UPDATE commande_lines cl
  SET shipped_quantity = 0, line_status = 'rupture'
  FROM _ship_lines sl
  WHERE sl.line_id = cl.id 
    AND (sl.conversion_status = 'error' OR sl.client_shipped_qty = 0);

  -- ═══ 7. Validate all lines processed ═══
  IF EXISTS (
    SELECT 1 FROM commande_lines 
    WHERE commande_id = p_commande_id AND line_status IS NULL
  ) THEN
    RAISE EXCEPTION 'LINES_NOT_ALL_PROCESSED: Some lines have no status after shipment';
  END IF;

  -- ═══ 8. Transition commande status ═══
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
$$;

COMMENT ON FUNCTION fn_ship_commande(UUID, UUID, JSONB) IS
'Expédition B2B V2 avec allocation mutualisée et garde-fou de cohérence. '
'Groupes cohérents: allocation multi-membres par stock décroissant. '
'Groupes incohérents: fallback carrier seul (pas de mutualisation). '
'Produits hors groupe: groupe virtuel de 1 (comportement identique à V1). '
'Toute allocation passe par fn_post_stock_document (clamping + traçabilité).';
