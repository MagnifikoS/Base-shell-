-- ═══════════════════════════════════════════════════════════════════════════
-- STK-03: Void Authorization Check in fn_void_stock_document
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Finding: Any authenticated user with stock module access can void documents.
-- Voiding is a destructive operation that should require write-level access.
--
-- Fix: Add write-level permission check at the start of fn_void_stock_document.
-- Since the function is SECURITY DEFINER, we cannot use has_module_access()
-- (which relies on auth.uid()). Instead we query role_permissions directly
-- using the p_voided_by parameter.
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_negative_products JSONB;
  v_missing_snapshot_zones JSONB;
  v_has_write_access BOOLEAN;
BEGIN
  -- ═══ 0a. STK-03: Authorization — caller must have write-level stock access ═══
  -- Admin shortcut
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

  -- ═══ 4. STK-LED-011: Per-product zone snapshot check ═══
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

  -- ═══ 5. STK-LED-015: Row-level locking on zone_stock_snapshots ═══
  PERFORM 1 FROM zone_stock_snapshots zss
  WHERE zss.establishment_id = v_doc.establishment_id
    AND zss.storage_zone_id IN (
      SELECT DISTINCT e.storage_zone_id
      FROM stock_events e
      WHERE e.document_id = p_document_id
        AND e.event_type != 'VOID'
    )
  FOR UPDATE;

  -- ═══ 6. STK-LED-016: Negative stock check ═══
  WITH original_events_by_zone AS (
    SELECT
      e.product_id,
      e.storage_zone_id AS product_zone_id,
      SUM(-e.delta_quantity_canonical) AS void_delta
    FROM stock_events e
    WHERE e.document_id = p_document_id
      AND e.event_type != 'VOID'
    GROUP BY e.product_id, e.storage_zone_id
  ),
  zone_snapshots AS (
    SELECT zss.storage_zone_id, zss.id AS zss_id, zss.snapshot_version_id
    FROM zone_stock_snapshots zss
    WHERE zss.establishment_id = v_doc.establishment_id
  ),
  current_estimates AS (
    SELECT
      oez.product_id,
      oez.product_zone_id,
      oez.void_delta,
      COALESCE(il.quantity, 0) AS snapshot_qty,
      COALESCE(ev_sum.total_delta, 0) AS events_delta
    FROM original_events_by_zone oez
    JOIN zone_snapshots zs ON zs.storage_zone_id = oez.product_zone_id
    LEFT JOIN inventory_lines il
      ON il.session_id = zs.snapshot_version_id
      AND il.product_id = oez.product_id
    LEFT JOIN (
      SELECT se.product_id, se.storage_zone_id, SUM(se.delta_quantity_canonical) AS total_delta
      FROM stock_events se
      JOIN zone_snapshots zs2 ON zs2.storage_zone_id = se.storage_zone_id
      WHERE se.snapshot_version_id = zs2.zss_id
      GROUP BY se.product_id, se.storage_zone_id
    ) ev_sum ON ev_sum.product_id = oez.product_id AND ev_sum.storage_zone_id = oez.product_zone_id
  ),
  negatives AS (
    SELECT
      product_id,
      product_zone_id,
      snapshot_qty,
      events_delta,
      void_delta,
      ROUND((snapshot_qty + events_delta + void_delta)::numeric, 4) AS resulting_stock
    FROM current_estimates
    WHERE ROUND((snapshot_qty + events_delta + void_delta)::numeric, 4) < 0
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'product_id', product_id,
      'zone_id', product_zone_id,
      'current_estimated', ROUND((snapshot_qty + events_delta)::numeric, 4),
      'void_delta', void_delta,
      'resulting_stock', resulting_stock
    )
  ), '[]'::jsonb) INTO v_negative_products
  FROM negatives;

  IF v_negative_products != '[]'::jsonb THEN
    RAISE EXCEPTION 'NEGATIVE_STOCK_ON_VOID:%', v_negative_products::text;
  END IF;

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

  -- ═══ 8. Create void correction document (POSTED immediately) ═══
  INSERT INTO stock_documents (
    establishment_id, organization_id, storage_zone_id, supplier_id,
    type, status, created_by, posted_by, posted_at
  ) VALUES (
    v_doc.establishment_id, v_doc.organization_id, v_doc.storage_zone_id, v_doc.supplier_id,
    v_doc.type, 'POSTED', p_voided_by, p_voided_by, now()
  ) RETURNING id INTO v_void_doc_id;

  -- ═══ 9. INSERT inverse events (exact negation, round4) ═══
  INSERT INTO stock_events (
    establishment_id, organization_id, storage_zone_id, product_id,
    document_id, event_type, event_reason,
    delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label,
    context_hash, snapshot_version_id,
    override_flag, override_reason, posted_by,
    voids_event_id, voids_document_id
  )
  SELECT
    e.establishment_id,
    e.organization_id,
    e.storage_zone_id,
    e.product_id,
    v_void_doc_id,
    'VOID'::stock_event_type,
    p_void_reason,
    ROUND(-e.delta_quantity_canonical, 4),
    e.canonical_unit_id,
    e.canonical_family,
    e.canonical_label,
    e.context_hash,
    e.snapshot_version_id,
    false,
    NULL,
    p_voided_by,
    e.id,
    p_document_id
  FROM stock_events e
  WHERE e.document_id = p_document_id
    AND e.event_type != 'VOID';

  GET DIAGNOSTICS v_void_event_count = ROW_COUNT;

  -- ═══ 10. Verify balance (sum of original + void must = 0 per product) ═══
  PERFORM 1 FROM (
    SELECT product_id, ROUND(SUM(delta_quantity_canonical)::numeric, 4) AS balance
    FROM stock_events
    WHERE document_id IN (p_document_id, v_void_doc_id)
    GROUP BY product_id
    HAVING ROUND(SUM(delta_quantity_canonical)::numeric, 4) != 0
  ) unbalanced
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'VOID_BALANCE_ERROR: inverse events do not sum to zero';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'document_id', p_document_id,
    'void_document_id', v_void_doc_id,
    'void_events_created', v_void_event_count,
    'original_events', v_original_event_count
  );
END;
$$;

-- Re-apply REVOKE (CREATE OR REPLACE resets grants)
REVOKE EXECUTE ON FUNCTION public.fn_void_stock_document(uuid, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_void_stock_document(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_void_stock_document(uuid, uuid, text) FROM public;
