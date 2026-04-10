
-- ═══════════════════════════════════════════════════════════════════════
-- ÉTAPE 5 : Expédition multi-stock mutualisé
--
-- Remplace la logique "1 import = 1 produit réel" par une allocation
-- intelligente sur tous les membres du groupe mutualisé.
--
-- Règle d'allocation :
--   1. Résoudre le groupe via fn_get_group_members
--   2. Calculer le stock disponible de chaque membre
--   3. Trier par stock décroissant
--   4. Consommer séquentiellement jusqu'à la quantité demandée
--
-- Cas couverts :
--   A. Produit hors groupe → comportement identique (groupe virtuel de 1)
--   B. Groupe cohérent, 1 membre a tout le stock → tout part de lui
--   C. Groupe cohérent, stock réparti → allocation multi-membres
--   D. Stock total insuffisant → clamp normal
--   E. Groupe incohérent → pas de mutualisation (1 seul produit)
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
    conv.supplier_unit_id,
    conv.supplier_quantity,
    conv.supplier_family,
    conv.status AS conversion_status,
    CASE 
      WHEN conv.supplier_quantity IS NOT NULL AND conv.supplier_quantity != 0 
      THEN LEAST(GREATEST((li.value->>'shipped_quantity')::numeric, 0), cl.canonical_quantity) / conv.supplier_quantity
      ELSE NULL 
    END AS conversion_factor,
    -- Is this product in a coherent mutualized group?
    gm.is_mutualized,
    gm.group_id
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
  -- Get mutualization info for the carrier (one row per line is enough here)
  LEFT JOIN LATERAL (
    SELECT g.is_mutualized, g.group_id
    FROM fn_get_group_members(bip.source_product_id, v_commande.supplier_establishment_id) g
    LIMIT 1
  ) gm ON true
  ORDER BY cl.id, bip.imported_at DESC;

  v_line_count := (SELECT count(*) FROM _ship_lines);

  -- ═══ 2b. Count conversion errors ═══
  SELECT count(*) INTO v_conversion_error_count
  FROM _ship_lines WHERE conversion_status = 'error';

  -- ═══ 2b-LOG. Log conversion errors ═══
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
  -- For each line, expand the carrier into all group members,
  -- compute available stock per member, and allocate by descending stock.
  -- Result: _allocation_lines (member_product_id, zone_id, allocated_qty)
  -- ═══════════════════════════════════════════════════════════════

  CREATE TEMP TABLE _allocation_lines ON COMMIT DROP AS
  WITH group_members_expanded AS (
    -- For each ship line, get all group members (or just the product itself if not mutualized)
    SELECT
      sl.line_id,
      sl.client_shipped_qty,
      sl.supplier_quantity AS total_supplier_qty,
      sl.supplier_unit_id,
      sl.supplier_family,
      sl.conversion_status,
      sl.conversion_factor,
      sl.is_mutualized,
      gm.member_product_id,
      mp.storage_zone_id AS member_zone_id,
      mp.nom_produit AS member_product_name
    FROM _ship_lines sl
    LEFT JOIN LATERAL (
      SELECT g.member_product_id
      FROM fn_get_group_members(sl.carrier_product_id, v_commande.supplier_establishment_id) g
    ) gm ON true
    JOIN products_v2 mp ON mp.id = gm.member_product_id
    WHERE sl.conversion_status != 'error'
      AND sl.client_shipped_qty > 0
  ),
  member_stock AS (
    -- Compute available stock for each member
    SELECT
      gme.*,
      GREATEST(
        COALESCE(il.quantity, 0) + COALESCE(SUM(se.delta_quantity_canonical), 0),
        0
      ) AS available_stock
    FROM group_members_expanded gme
    LEFT JOIN zone_stock_snapshots zss 
      ON zss.storage_zone_id = gme.member_zone_id
      AND zss.establishment_id = v_commande.supplier_establishment_id
    LEFT JOIN inventory_lines il 
      ON il.session_id = zss.snapshot_version_id 
      AND il.product_id = gme.member_product_id
    LEFT JOIN stock_events se 
      ON se.product_id = gme.member_product_id 
      AND se.storage_zone_id = gme.member_zone_id
      AND se.snapshot_version_id = zss.snapshot_version_id
      AND se.canonical_family = gme.supplier_family
    GROUP BY gme.line_id, gme.client_shipped_qty, gme.total_supplier_qty, 
             gme.supplier_unit_id, gme.supplier_family, gme.conversion_status,
             gme.conversion_factor, gme.is_mutualized,
             gme.member_product_id, gme.member_zone_id, gme.member_product_name,
             il.quantity
  ),
  ranked_members AS (
    -- Rank members by available stock (descending) for each line
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY line_id ORDER BY available_stock DESC, member_product_id) AS rank_order
    FROM member_stock
  ),
  allocated AS (
    -- Sequential allocation: consume from highest stock first
    -- Using recursive CTE to allocate across members
    SELECT
      rm.line_id,
      rm.member_product_id,
      rm.member_zone_id,
      rm.member_product_name,
      rm.supplier_unit_id,
      rm.supplier_family,
      rm.conversion_factor,
      rm.rank_order,
      rm.available_stock,
      rm.total_supplier_qty,
      -- How much has been allocated by previous members?
      COALESCE(
        SUM(LEAST(rm2.available_stock, GREATEST(rm2.total_supplier_qty - COALESCE(prev_alloc.prev_sum, 0), 0)))
        FILTER (WHERE rm2.rank_order < rm.rank_order),
        0
      ) AS already_allocated,
      rm.total_supplier_qty AS demand
    FROM ranked_members rm
    LEFT JOIN ranked_members rm2 ON rm2.line_id = rm.line_id AND rm2.rank_order < rm.rank_order
    LEFT JOIN LATERAL (
      SELECT SUM(LEAST(rm3.available_stock, GREATEST(rm3.total_supplier_qty - 
        COALESCE((SELECT SUM(LEAST(rm4.available_stock, rm4.total_supplier_qty)) 
                  FROM ranked_members rm4 WHERE rm4.line_id = rm3.line_id AND rm4.rank_order < rm3.rank_order), 0)
      , 0))) as prev_sum
      FROM ranked_members rm3 
      WHERE rm3.line_id = rm.line_id AND rm3.rank_order < rm.rank_order
    ) prev_alloc ON true
    GROUP BY rm.line_id, rm.member_product_id, rm.member_zone_id, rm.member_product_name,
             rm.supplier_unit_id, rm.supplier_family, rm.conversion_factor,
             rm.rank_order, rm.available_stock, rm.total_supplier_qty, prev_alloc.prev_sum
  )
  -- Final: compute each member's allocation
  SELECT
    a.line_id,
    a.member_product_id,
    a.member_zone_id,
    a.member_product_name,
    a.supplier_unit_id,
    a.supplier_family,
    a.conversion_factor,
    -- This member's allocation = min(available_stock, remaining_demand)
    LEAST(
      a.available_stock,
      GREATEST(a.demand - a.already_allocated, 0)
    ) AS allocated_qty
  FROM allocated a;

  -- ═══════════════════════════════════════════════════════════════
  -- ═══ 4. Per zone: DRAFT → lines → fn_post_stock_document ═══
  -- Now uses _allocation_lines instead of _ship_lines directly
  -- ═══════════════════════════════════════════════════════════════

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
  -- Sum all allocated quantities across members for each line,
  -- then back-convert to client units.
  UPDATE commande_lines cl
  SET 
    shipped_quantity = CASE
      WHEN alloc_sum.total_allocated IS NOT NULL AND sl.conversion_factor IS NOT NULL AND sl.conversion_factor != 0
        THEN ROUND(alloc_sum.total_allocated * sl.conversion_factor, 4)
      WHEN alloc_sum.total_allocated IS NOT NULL 
        THEN ROUND(alloc_sum.total_allocated, 4)
      ELSE 0
    END,
    line_status = CASE
      WHEN alloc_sum.total_allocated IS NULL OR ROUND(alloc_sum.total_allocated, 4) = 0 
        THEN 'rupture'
      WHEN ROUND(alloc_sum.total_allocated, 4) < ROUND(sl.supplier_quantity, 4)
        THEN 'modifie'
      ELSE 'ok'
    END
  FROM _ship_lines sl
  LEFT JOIN (
    -- Sum actual stock events (post-clamp reality) across all members for each line
    SELECT al.line_id, SUM(
      COALESCE(
        (SELECT ABS(se.delta_quantity_canonical) 
         FROM stock_events se 
         WHERE se.product_id = al.member_product_id
           AND se.storage_zone_id = al.member_zone_id
           AND se.event_reason = 'B2B_SHIPMENT'
           AND se.document_id IN (
             SELECT sd.id FROM stock_documents sd 
             WHERE sd.source_order_id = p_commande_id 
               AND sd.storage_zone_id = al.member_zone_id
           )
         ORDER BY se.posted_at DESC
         LIMIT 1
        ), 0)
    ) AS total_allocated
    FROM _allocation_lines al
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
'Expédition B2B avec allocation mutualisée. '
'Pour chaque ligne de commande, résout le groupe mutualisé via fn_get_group_members, '
'calcule le stock disponible de chaque membre, et alloue par stock décroissant. '
'Un produit hors groupe est traité comme un groupe virtuel de 1 (comportement identique). '
'Les groupes incohérents ne sont pas mutualisés (fallback safe via fn_get_group_members).';
