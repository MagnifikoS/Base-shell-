
-- ═══════════════════════════════════════════════════════════════════════════
-- STOCK ZERO V1 — Phase 1: Fix fn_void_stock_document parameter name issue
-- Must DROP first due to parameter name change (p_reason → p_void_reason)
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.fn_void_stock_document(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.fn_void_stock_document(
  p_document_id UUID,
  p_voided_by UUID,
  p_void_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_doc RECORD;
  v_rows_affected INT;
  v_void_event_count INT;
  v_original_event_count INT;
  v_void_doc_id UUID;
  v_missing_snapshot_zones JSONB;
  v_has_write_access BOOLEAN;
BEGIN
  -- ═══ 0a. STK-03: Authorization ═══
  IF public.is_admin(p_voided_by) THEN
    v_has_write_access := true;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      JOIN public.role_permissions rp ON rp.role_id = r.id
      WHERE ur.user_id = p_voided_by
        AND rp.module_key = 'stock'
        AND CASE rp.access_level
              WHEN 'write' THEN true
              WHEN 'full' THEN true
              ELSE false
            END
    ) INTO v_has_write_access;
  END IF;

  IF v_has_write_access IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VOID_ACCESS_DENIED',
      'message', 'Vous n''avez pas les droits pour annuler un document de stock.');
  END IF;

  -- ═══ 0b. Fetch document ═══
  SELECT * INTO v_doc FROM stock_documents WHERE id = p_document_id;
  IF v_doc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DOCUMENT_NOT_FOUND');
  END IF;

  -- ═══ 1. Must be POSTED ═══
  IF v_doc.status != 'POSTED' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_POSTED', 'current_status', v_doc.status::text);
  END IF;

  -- ═══ 2. Void reason required ═══
  IF p_void_reason IS NULL OR TRIM(p_void_reason) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VOID_REASON_REQUIRED');
  END IF;

  -- ═══ 3. Count original events ═══
  SELECT COUNT(*) INTO v_original_event_count
  FROM stock_events
  WHERE document_id = p_document_id AND event_type != 'VOID';

  IF v_original_event_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_EVENTS_TO_VOID');
  END IF;

  -- ═══ 4. Per-product zone snapshot check ═══
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'zone_id', missing.event_zone_id,
    'zone_name', COALESCE(sz.name, missing.event_zone_id::text)
  )), '[]'::jsonb)
  INTO v_missing_snapshot_zones
  FROM (
    SELECT DISTINCT e.storage_zone_id AS event_zone_id
    FROM stock_events e
    WHERE e.document_id = p_document_id
      AND e.event_type != 'VOID'
  ) missing
  LEFT JOIN storage_zones sz ON sz.id = missing.event_zone_id
  WHERE NOT EXISTS (
    SELECT 1 FROM zone_stock_snapshots zss
    WHERE zss.establishment_id = v_doc.establishment_id
      AND zss.storage_zone_id = missing.event_zone_id
  );

  IF v_missing_snapshot_zones != '[]'::jsonb THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'NO_ACTIVE_SNAPSHOT_FOR_VOID_ZONES',
      'zones', v_missing_snapshot_zones,
      'message', 'Snapshot actif manquant pour certaines zones concernées par l''annulation.'
    );
  END IF;

  -- ═══ 5. Row-level locking ═══
  PERFORM 1 FROM zone_stock_snapshots zss
  WHERE zss.establishment_id = v_doc.establishment_id
    AND zss.storage_zone_id IN (
      SELECT DISTINCT e.storage_zone_id
      FROM stock_events e
      WHERE e.document_id = p_document_id
        AND e.event_type != 'VOID'
    )
  FOR UPDATE;

  -- ═══ 6. STOCK ZERO V1: No negative stock check — replaced by clamped void events ═══

  -- ═══ 7. Mark original document as VOID ═══
  UPDATE stock_documents
  SET status = 'VOID',
      voided_by = p_voided_by,
      voided_at = now(),
      lock_version = lock_version + 1,
      updated_at = now()
  WHERE id = p_document_id
    AND status = 'POSTED';

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  IF v_rows_affected = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VOID_CONFLICT');
  END IF;

  -- ═══ 8. Create void correction document ═══
  INSERT INTO stock_documents (
    establishment_id, organization_id, storage_zone_id, supplier_id,
    type, status, created_by, posted_by, posted_at
  ) VALUES (
    v_doc.establishment_id, v_doc.organization_id, v_doc.storage_zone_id, v_doc.supplier_id,
    v_doc.type, 'POSTED', p_voided_by, p_voided_by, now()
  ) RETURNING id INTO v_void_doc_id;

  -- ═══ 9. INSERT clamped inverse events ═══
  WITH zone_snapshots AS (
    SELECT zss.storage_zone_id, zss.snapshot_version_id
    FROM zone_stock_snapshots zss
    WHERE zss.establishment_id = v_doc.establishment_id
  ),
  original_events AS (
    SELECT
      e.id AS original_event_id,
      e.establishment_id,
      e.organization_id,
      e.storage_zone_id,
      e.product_id,
      e.delta_quantity_canonical,
      e.canonical_unit_id,
      e.canonical_family,
      e.canonical_label,
      e.context_hash,
      e.snapshot_version_id,
      ROUND(-e.delta_quantity_canonical, 4) AS raw_void_delta
    FROM stock_events e
    WHERE e.document_id = p_document_id
      AND e.event_type != 'VOID'
  ),
  current_stocks AS (
    SELECT
      oe.original_event_id,
      oe.product_id,
      oe.storage_zone_id,
      oe.raw_void_delta,
      ROUND((COALESCE(il.quantity, 0) + COALESCE(ev_sum.total_delta, 0))::numeric, 4) AS current_stock
    FROM original_events oe
    JOIN zone_snapshots zs ON zs.storage_zone_id = oe.storage_zone_id
    LEFT JOIN inventory_lines il
      ON il.session_id = zs.snapshot_version_id
      AND il.product_id = oe.product_id
    LEFT JOIN (
      SELECT se.product_id, se.storage_zone_id, SUM(se.delta_quantity_canonical) AS total_delta
      FROM stock_events se
      JOIN zone_snapshots zs2 ON zs2.storage_zone_id = se.storage_zone_id
        AND zs2.snapshot_version_id = se.snapshot_version_id
      WHERE se.establishment_id = v_doc.establishment_id
      GROUP BY se.product_id, se.storage_zone_id
    ) ev_sum ON ev_sum.product_id = oe.product_id AND ev_sum.storage_zone_id = oe.storage_zone_id
  ),
  clamped_voids AS (
    SELECT
      cs.original_event_id,
      oe.*,
      CASE
        WHEN cs.raw_void_delta >= 0 THEN cs.raw_void_delta
        ELSE GREATEST(cs.raw_void_delta, -GREATEST(cs.current_stock, 0))
      END AS effective_void_delta
    FROM current_stocks cs
    JOIN original_events oe ON oe.original_event_id = cs.original_event_id
  )
  INSERT INTO stock_events (
    establishment_id, organization_id, storage_zone_id, product_id,
    document_id, event_type, event_reason,
    delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label,
    context_hash, snapshot_version_id,
    override_flag, override_reason, posted_by,
    voids_event_id, voids_document_id
  )
  SELECT
    cv.establishment_id,
    cv.organization_id,
    cv.storage_zone_id,
    cv.product_id,
    v_void_doc_id,
    'VOID'::stock_event_type,
    p_void_reason,
    cv.effective_void_delta,
    cv.canonical_unit_id,
    cv.canonical_family,
    cv.canonical_label,
    cv.context_hash,
    cv.snapshot_version_id,
    false,
    NULL,
    p_voided_by,
    cv.original_event_id,
    p_document_id
  FROM clamped_voids cv
  WHERE cv.effective_void_delta != 0;

  GET DIAGNOSTICS v_void_event_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'document_id', p_document_id,
    'void_document_id', v_void_doc_id,
    'void_events_created', v_void_event_count,
    'original_events', v_original_event_count
  );
END;
$$;

-- Re-apply REVOKE
REVOKE EXECUTE ON FUNCTION public.fn_void_stock_document(uuid, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_void_stock_document(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_void_stock_document(uuid, uuid, text) FROM public;

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_transfer_product_zone — Propagate clamped qty to receipt
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.fn_transfer_product_zone(UUID, UUID, UUID, NUMERIC, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_transfer_product_zone(
  p_product_id UUID,
  p_new_zone_id UUID,
  p_user_id UUID,
  p_estimated_qty NUMERIC DEFAULT 0,
  p_canonical_unit_id UUID DEFAULT NULL,
  p_canonical_family TEXT DEFAULT NULL,
  p_context_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_old_zone_id UUID;
  v_est_id UUID;
  v_org_id UUID;
  v_withdrawal_doc RECORD;
  v_receipt_doc RECORD;
  v_snapshot_version_id UUID;
  v_canonical_label TEXT;
  v_post_result JSONB;
  v_idempotency_key TEXT;
  v_context_hash TEXT;
  v_effective_qty NUMERIC;
BEGIN
  SELECT id, establishment_id, storage_zone_id
  INTO v_product
  FROM products_v2
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;

  v_old_zone_id := v_product.storage_zone_id;
  v_est_id := v_product.establishment_id;

  SELECT organization_id INTO v_org_id
  FROM establishments WHERE id = v_est_id;

  IF v_old_zone_id = p_new_zone_id THEN
    RETURN jsonb_build_object('ok', true, 'transferred_qty', 0, 'message', 'SAME_ZONE_NOOP');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage_zones WHERE id = p_new_zone_id AND establishment_id = v_est_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TARGET_ZONE');
  END IF;

  IF v_old_zone_id IS NULL AND p_estimated_qty > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_SOURCE_ZONE_WITH_STOCK');
  END IF;

  SELECT name INTO v_canonical_label
  FROM measurement_units WHERE id = p_canonical_unit_id;

  v_context_hash := COALESCE(
    p_context_hash,
    ('auto:' || p_product_id::text || ':' || COALESCE(p_canonical_unit_id::text, 'null') || ':' || COALESCE(p_canonical_family, 'null'))
  );

  v_effective_qty := p_estimated_qty;

  IF p_estimated_qty > 0 AND v_old_zone_id IS NOT NULL AND p_canonical_unit_id IS NOT NULL THEN

    -- ========== WITHDRAWAL ==========
    v_idempotency_key := 'zone-transfer-w-' || p_product_id || '-' || extract(epoch from now())::text;
    INSERT INTO stock_documents (
      establishment_id, organization_id, storage_zone_id, type, status, created_by, idempotency_key
    ) VALUES (
      v_est_id, v_org_id, v_old_zone_id, 'WITHDRAWAL', 'DRAFT', p_user_id, v_idempotency_key
    ) RETURNING id, lock_version INTO v_withdrawal_doc;

    INSERT INTO stock_document_lines (
      document_id, product_id, delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label, context_hash
    ) VALUES (
      v_withdrawal_doc.id, p_product_id, -1 * p_estimated_qty, p_canonical_unit_id, p_canonical_family, v_canonical_label, v_context_hash
    );

    v_post_result := fn_post_stock_document(
      p_document_id := v_withdrawal_doc.id,
      p_expected_lock_version := v_withdrawal_doc.lock_version,
      p_posted_by := p_user_id,
      p_event_reason := 'Transfert zone : retrait (de ' || v_old_zone_id::text || ')'
    );

    IF NOT (v_post_result->>'ok')::boolean THEN
      RAISE EXCEPTION 'WITHDRAWAL_POST_FAILED: %', v_post_result->>'error';
    END IF;

    -- STOCK ZERO V1: Get effective quantity actually withdrawn
    IF (v_post_result->>'events_created')::int = 0 THEN
      v_effective_qty := 0;
    ELSIF (v_post_result->>'clamped_count')::int > 0 THEN
      SELECT ABS(se.delta_quantity_canonical) INTO v_effective_qty
      FROM stock_events se
      WHERE se.document_id = v_withdrawal_doc.id
        AND se.product_id = p_product_id
      LIMIT 1;
    END IF;

    -- ========== RECEIPT (use effective qty) ==========
    IF v_effective_qty > 0 THEN
      v_idempotency_key := 'zone-transfer-r-' || p_product_id || '-' || extract(epoch from now())::text;
      INSERT INTO stock_documents (
        establishment_id, organization_id, storage_zone_id, type, status, created_by, idempotency_key
      ) VALUES (
        v_est_id, v_org_id, p_new_zone_id, 'RECEIPT', 'DRAFT', p_user_id, v_idempotency_key
      ) RETURNING id, lock_version INTO v_receipt_doc;

      INSERT INTO stock_document_lines (
        document_id, product_id, delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label, context_hash
      ) VALUES (
        v_receipt_doc.id, p_product_id, v_effective_qty, p_canonical_unit_id, p_canonical_family, v_canonical_label, v_context_hash
      );

      v_post_result := fn_post_stock_document(
        p_document_id := v_receipt_doc.id,
        p_expected_lock_version := v_receipt_doc.lock_version,
        p_posted_by := p_user_id,
        p_event_reason := 'Transfert zone : réception (vers ' || p_new_zone_id::text || ')'
      );

      IF NOT (v_post_result->>'ok')::boolean THEN
        RAISE EXCEPTION 'RECEIPT_POST_FAILED: %', v_post_result->>'error';
      END IF;
    END IF;
  END IF;

  -- Initialize snapshot line in new zone
  SELECT snapshot_version_id INTO v_snapshot_version_id
  FROM zone_stock_snapshots
  WHERE storage_zone_id = p_new_zone_id
    AND establishment_id = v_est_id
  LIMIT 1;

  IF v_snapshot_version_id IS NOT NULL THEN
    DELETE FROM inventory_lines
    WHERE session_id = v_snapshot_version_id AND product_id = p_product_id;

    INSERT INTO inventory_lines (
      session_id, product_id, quantity, unit_id, created_via
    ) VALUES (
      v_snapshot_version_id, p_product_id, 0,
      COALESCE(p_canonical_unit_id, (SELECT stock_handling_unit_id FROM products_v2 WHERE id = p_product_id)),
      'INIT_AFTER_SNAPSHOT'
    );
  END IF;

  UPDATE products_v2 SET storage_zone_id = p_new_zone_id WHERE id = p_product_id;

  RETURN jsonb_build_object(
    'ok', true,
    'transferred_qty', v_effective_qty,
    'old_zone_id', v_old_zone_id,
    'new_zone_id', p_new_zone_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_ship_commande — Add stock clamp to B2B withdrawal events
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

  -- ═══ 1. Update lines with inline clamp ═══
  FOR v_line_input IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_input_qty := (v_line_input->>'shipped_quantity')::numeric;

    SELECT canonical_quantity INTO v_ordered_qty
    FROM commande_lines
    WHERE id = (v_line_input->>'line_id')::uuid AND commande_id = p_commande_id;

    v_final_qty := LEAST(v_input_qty, v_ordered_qty);
    IF v_final_qty < v_input_qty THEN
      v_clamped_count := v_clamped_count + 1;
    END IF;

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

      -- ── 5d. Create stock_document_lines ──
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

    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'line_count', v_line_count, 'clamped_count', v_clamped_count);
END;
$$;
