
-- ═══════════════════════════════════════════════════════════════════════════
-- STOCK ZERO V1 — Correctif A: fn_ship_commande cohérence shipped_quantity
--
-- PROBLÈME: shipped_quantity restait à la valeur saisie même quand le stock
-- était clampé. Résultat: commande marquée "expédiée 5" mais stock sorti = 0.
--
-- FIX: Après insertion des stock_events clampés, synchroniser shipped_quantity
-- avec le delta effectif. Si clamp = 0, line_status → 'rupture'.
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_clamped_count int := 0;
  v_input_qty numeric;
  v_ordered_qty numeric;
  v_final_qty numeric;
  v_doc_id uuid;
  v_idemp_key text;
  v_supplier_product record;
  v_supplier_est record;
  v_zone_id uuid;
  v_org_id uuid;
  v_bootstrap_session_id uuid;
  v_snapshot record;
  v_event_count int;
  -- NEW: for post-clamp sync
  v_effective_delta numeric;
  v_current_stock numeric;
  v_sync_rec record;
BEGIN
  -- ═══ 0. Lock commande ═══
  SELECT * INTO v_commande
  FROM commandes WHERE id = p_commande_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'commande_not_found');
  END IF;
  IF v_commande.status != 'ouverte' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'current', v_commande.status);
  END IF;

  -- ═══ 1. Update lines with inline clamp (to ordered qty only — stock clamp comes later) ═══
  FOR v_line_input IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_input_qty := (v_line_input->>'shipped_quantity')::numeric;

    SELECT canonical_quantity INTO v_ordered_qty
    FROM commande_lines
    WHERE id = (v_line_input->>'line_id')::uuid AND commande_id = p_commande_id;

    v_final_qty := LEAST(v_input_qty, v_ordered_qty);

    UPDATE commande_lines
    SET shipped_quantity = v_final_qty,
        line_status = v_line_input->>'line_status'
    WHERE id = (v_line_input->>'line_id')::uuid AND commande_id = p_commande_id;
    v_line_count := v_line_count + 1;
  END LOOP;

  -- ═══ 2. All lines processed? ═══
  SELECT NOT EXISTS (
    SELECT 1 FROM commande_lines WHERE commande_id = p_commande_id AND line_status IS NULL
  ) INTO v_all_processed;
  IF NOT v_all_processed THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lines_not_all_processed');
  END IF;

  -- ═══ 3. Validate shipped_quantity ═══
  IF EXISTS (
    SELECT 1 FROM commande_lines
    WHERE commande_id = p_commande_id AND line_status IN ('ok','modifie')
      AND (shipped_quantity IS NULL OR shipped_quantity < 0)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_shipped_quantity');
  END IF;
  IF EXISTS (
    SELECT 1 FROM commande_lines
    WHERE commande_id = p_commande_id AND line_status = 'rupture'
      AND COALESCE(shipped_quantity, 0) != 0
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rupture_quantity_must_be_zero');
  END IF;

  -- ═══ 4. Transition status ═══
  UPDATE commandes
  SET status = 'expediee', shipped_by = p_user_id::text, shipped_at = now(), updated_at = now()
  WHERE id = p_commande_id;

  -- ═══ 5. Stock ledger WITHDRAWAL ═══
  SELECT e.id, e.organization_id INTO v_supplier_est
  FROM establishments e WHERE e.id = v_commande.supplier_establishment_id;
  IF v_supplier_est IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'supplier_establishment_not_found');
  END IF;
  v_org_id := v_supplier_est.organization_id;
  v_idemp_key := 'ship:' || p_commande_id::text;

  CREATE TEMP TABLE _ship_lines ON COMMIT DROP AS
  SELECT
    cl.id as line_id, cl.shipped_quantity, cl.line_status, cl.canonical_unit_id,
    bip.source_product_id as supplier_product_id,
    sp.storage_zone_id as supplier_zone_id,
    sp.nom_produit as supplier_product_name,
    mu.family as canonical_family, mu.name as canonical_label
  FROM commande_lines cl
  JOIN b2b_imported_products bip
    ON bip.local_product_id = cl.product_id
    AND bip.establishment_id = v_commande.client_establishment_id
    AND bip.source_establishment_id = v_commande.supplier_establishment_id
  JOIN products_v2 sp ON sp.id = bip.source_product_id
  LEFT JOIN measurement_units mu ON mu.id = cl.canonical_unit_id
  WHERE cl.commande_id = p_commande_id
    AND cl.line_status IN ('ok','modifie') AND cl.shipped_quantity > 0;

  IF EXISTS (SELECT 1 FROM _ship_lines) THEN
    FOR v_zone_id IN SELECT DISTINCT supplier_zone_id FROM _ship_lines WHERE supplier_zone_id IS NOT NULL
    LOOP
      -- ── 5a. Bootstrap snapshot if needed ──
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
        SELECT v_bootstrap_session_id, sl.supplier_product_id, 0, sl.canonical_unit_id, 0, 'INIT_AFTER_SNAPSHOT'
        FROM _ship_lines sl WHERE sl.supplier_zone_id = v_zone_id
        ON CONFLICT DO NOTHING;
      END IF;

      -- ── 5b. Validate snapshot ──
      SELECT * INTO v_snapshot FROM zone_stock_snapshots
      WHERE establishment_id = v_commande.supplier_establishment_id AND storage_zone_id = v_zone_id;

      IF v_snapshot IS NULL THEN
        RAISE EXCEPTION 'NO_SNAPSHOT_FOR_ZONE: % in establishment %', v_zone_id, v_commande.supplier_establishment_id;
      END IF;

      -- ── 5c. Create document directly as POSTED ──
      v_doc_id := gen_random_uuid();
      INSERT INTO stock_documents (
        id, establishment_id, organization_id, storage_zone_id,
        type, status, created_by, idempotency_key, source_order_id,
        posted_by, posted_at, lock_version
      ) VALUES (
        v_doc_id, v_commande.supplier_establishment_id, v_org_id, v_zone_id,
        'WITHDRAWAL', 'POSTED', p_user_id, v_idemp_key || ':' || v_zone_id::text, p_commande_id,
        p_user_id, now(), 2
      );

      -- ── 5d. Create stock_document_lines (uses original shipped_quantity for document trace) ──
      INSERT INTO stock_document_lines (
        document_id, product_id, delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label, context_hash
      )
      SELECT v_doc_id, sl.supplier_product_id, -1 * sl.shipped_quantity, sl.canonical_unit_id,
        sl.canonical_family, sl.canonical_label,
        'auto:' || sl.supplier_product_id::text || ':' || sl.canonical_unit_id::text || ':' || COALESCE(sl.canonical_family, 'null')
      FROM _ship_lines sl WHERE sl.supplier_zone_id = v_zone_id;

      -- ── 5e. STOCK ZERO V1: Create stock_events with CLAMP ──
      INSERT INTO stock_events (
        establishment_id, organization_id, storage_zone_id, product_id,
        document_id, event_type, event_reason,
        delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label,
        context_hash, snapshot_version_id,
        override_flag, override_reason, posted_by
      )
      SELECT
        v_commande.supplier_establishment_id,
        v_org_id,
        v_zone_id,
        sl.supplier_product_id,
        v_doc_id,
        'WITHDRAWAL'::stock_event_type,
        'B2B_SHIPMENT',
        GREATEST(
          -1 * sl.shipped_quantity,
          -GREATEST(
            ROUND((COALESCE(il.quantity, 0) + COALESCE(ev_sum.total_delta, 0))::numeric, 4),
            0
          )
        ),
        sl.canonical_unit_id,
        sl.canonical_family,
        COALESCE(sl.canonical_label, ''),
        'auto:' || sl.supplier_product_id::text || ':' || sl.canonical_unit_id::text || ':' || COALESCE(sl.canonical_family, 'null'),
        v_snapshot.snapshot_version_id,
        true,
        'Expedition commande B2B ' || p_commande_id::text,
        p_user_id
      FROM _ship_lines sl
      LEFT JOIN inventory_lines il
        ON il.session_id = v_snapshot.snapshot_version_id
        AND il.product_id = sl.supplier_product_id
      LEFT JOIN (
        SELECT se.product_id, SUM(se.delta_quantity_canonical) AS total_delta
        FROM stock_events se
        WHERE se.establishment_id = v_commande.supplier_establishment_id
          AND se.storage_zone_id = v_zone_id
          AND se.snapshot_version_id = v_snapshot.snapshot_version_id
        GROUP BY se.product_id
      ) ev_sum ON ev_sum.product_id = sl.supplier_product_id
      WHERE sl.supplier_zone_id = v_zone_id
        AND GREATEST(
          -1 * sl.shipped_quantity,
          -GREATEST(
            ROUND((COALESCE(il.quantity, 0) + COALESCE(ev_sum.total_delta, 0))::numeric, 4),
            0
          )
        ) != 0;

      -- ══════════════════════════════════════════════════════════════════════
      -- 5f. NEW — SYNC shipped_quantity with effective stock delta
      -- This is the critical fix: align commande_lines.shipped_quantity
      -- with what was ACTUALLY withdrawn from stock after clamping.
      -- If effective = 0 → shipped_quantity = 0, line_status = 'rupture'
      -- If effective < requested → shipped_quantity = effective, line_status = 'modifie'
      -- ══════════════════════════════════════════════════════════════════════
      FOR v_sync_rec IN
        SELECT
          sl.line_id,
          sl.shipped_quantity as requested_qty,
          ABS(COALESCE(se_eff.effective_delta, 0)) as effective_qty
        FROM _ship_lines sl
        LEFT JOIN (
          SELECT se.product_id, se.delta_quantity_canonical as effective_delta
          FROM stock_events se
          WHERE se.document_id = v_doc_id
        ) se_eff ON se_eff.product_id = sl.supplier_product_id
        WHERE sl.supplier_zone_id = v_zone_id
      LOOP
        IF v_sync_rec.effective_qty = 0 THEN
          -- Clamp total: rien n'est sorti → rupture
          UPDATE commande_lines
          SET shipped_quantity = 0, line_status = 'rupture'
          WHERE id = v_sync_rec.line_id;
          v_clamped_count := v_clamped_count + 1;
        ELSIF v_sync_rec.effective_qty < v_sync_rec.requested_qty THEN
          -- Clamp partiel: ajuster shipped_quantity au réel
          UPDATE commande_lines
          SET shipped_quantity = v_sync_rec.effective_qty, line_status = 'modifie'
          WHERE id = v_sync_rec.line_id;
          v_clamped_count := v_clamped_count + 1;
        END IF;
        -- Si effective = requested → pas de changement (déjà correct)
      END LOOP;

    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'line_count', v_line_count, 'clamped_count', v_clamped_count);
END;
$$;
