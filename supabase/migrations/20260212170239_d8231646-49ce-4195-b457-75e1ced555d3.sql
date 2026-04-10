
-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 3: Atomic POST & VOID functions for Stock Ledger
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_post_stock_document
-- Atomic: lock_version check → UPDATE → negative stock check → INSERT events
-- All in one transaction — RAISE EXCEPTION rolls back everything
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_post_stock_document(
  p_document_id UUID,
  p_expected_lock_version INT,
  p_posted_by UUID,
  p_idempotency_key TEXT,
  p_override_flag BOOLEAN DEFAULT FALSE,
  p_override_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_doc RECORD;
  v_snapshot RECORD;
  v_rows_affected INT;
  v_event_count INT;
  v_line_count INT;
  v_negative_products JSONB;
BEGIN
  -- ═══ 0. Fetch document ═══
  SELECT * INTO v_doc FROM stock_documents WHERE id = p_document_id;
  IF v_doc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DOCUMENT_NOT_FOUND');
  END IF;

  -- ═══ 1. Idempotency: already posted with same key → return success ═══
  IF v_doc.status = 'POSTED' AND v_doc.idempotency_key IS NOT NULL 
     AND v_doc.idempotency_key = p_idempotency_key THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'document_id', p_document_id);
  END IF;

  -- ═══ 2. Must be DRAFT ═══
  IF v_doc.status != 'DRAFT' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_DRAFT', 'current_status', v_doc.status::text);
  END IF;

  -- ═══ 3. Snapshot must exist for zone ═══
  SELECT * INTO v_snapshot FROM zone_stock_snapshots
  WHERE establishment_id = v_doc.establishment_id
    AND storage_zone_id = v_doc.storage_zone_id;

  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SNAPSHOT', 
      'zone_id', v_doc.storage_zone_id);
  END IF;

  -- ═══ 4. Must have lines ═══
  SELECT COUNT(*) INTO v_line_count FROM stock_document_lines WHERE document_id = p_document_id;
  IF v_line_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LINES');
  END IF;

  -- ═══ 5. Override validation ═══
  IF p_override_flag = true AND (p_override_reason IS NULL OR TRIM(p_override_reason) = '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OVERRIDE_REASON_REQUIRED');
  END IF;

  -- ═══ 6. ATOMIC UPDATE with lock_version check ═══
  -- This is THE serialization point for multi-device concurrency
  UPDATE stock_documents
  SET status = 'POSTED',
      lock_version = lock_version + 1,
      idempotency_key = p_idempotency_key,
      posted_by = p_posted_by,
      posted_at = now(),
      updated_at = now()
  WHERE id = p_document_id
    AND lock_version = p_expected_lock_version
    AND status = 'DRAFT';

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  IF v_rows_affected = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LOCK_CONFLICT',
      'expected_version', p_expected_lock_version,
      'current_version', v_doc.lock_version);
  END IF;

  -- ═══ 7. Negative stock check (after lock, before events) ═══
  -- If override_flag is false, check if any line would cause negative stock
  IF p_override_flag = false THEN
    WITH current_estimates AS (
      SELECT
        dl.product_id,
        dl.delta_quantity_canonical AS line_delta,
        COALESCE(il.quantity, 0) AS snapshot_qty,
        COALESCE(ev_sum.total_delta, 0) AS events_delta
      FROM stock_document_lines dl
      LEFT JOIN inventory_lines il 
        ON il.session_id = v_snapshot.snapshot_version_id 
        AND il.product_id = dl.product_id
      LEFT JOIN (
        SELECT product_id, SUM(delta_quantity_canonical) AS total_delta
        FROM stock_events
        WHERE storage_zone_id = v_doc.storage_zone_id
          AND snapshot_version_id = v_snapshot.id
        GROUP BY product_id
      ) ev_sum ON ev_sum.product_id = dl.product_id
      WHERE dl.document_id = p_document_id
    ),
    negatives AS (
      SELECT 
        product_id,
        snapshot_qty,
        events_delta,
        line_delta,
        ROUND((snapshot_qty + events_delta + line_delta)::numeric, 4) AS resulting_stock
      FROM current_estimates
      WHERE ROUND((snapshot_qty + events_delta + line_delta)::numeric, 4) < 0
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'product_id', product_id,
        'current_estimated', ROUND((snapshot_qty + events_delta)::numeric, 4),
        'delta', line_delta,
        'resulting_stock', resulting_stock
      )
    ), '[]'::jsonb) INTO v_negative_products
    FROM negatives;

    -- If any product goes negative → RAISE EXCEPTION (rolls back the UPDATE)
    IF v_negative_products != '[]'::jsonb THEN
      RAISE EXCEPTION 'NEGATIVE_STOCK:%', v_negative_products::text;
    END IF;
  END IF;

  -- ═══ 8. INSERT stock_events from document lines ═══
  INSERT INTO stock_events (
    establishment_id, organization_id, storage_zone_id, product_id,
    document_id, event_type, event_reason,
    delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label,
    context_hash, snapshot_version_id,
    override_flag, override_reason, posted_by
  )
  SELECT
    v_doc.establishment_id,
    v_doc.organization_id,
    v_doc.storage_zone_id,
    dl.product_id,
    p_document_id,
    v_doc.type::text::stock_event_type,
    v_doc.type::text,
    dl.delta_quantity_canonical,
    dl.canonical_unit_id,
    dl.canonical_family,
    dl.canonical_label,
    dl.context_hash,
    v_snapshot.id,
    p_override_flag,
    p_override_reason,
    p_posted_by
  FROM stock_document_lines dl
  WHERE dl.document_id = p_document_id;

  GET DIAGNOSTICS v_event_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'document_id', p_document_id,
    'events_created', v_event_count,
    'snapshot_version_id', v_snapshot.id,
    'new_lock_version', p_expected_lock_version + 1
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- fn_void_stock_document
-- Atomic: verify POSTED → mark VOID → INSERT inverse events
-- Creates a new void document for clean audit trail
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
  v_snapshot RECORD;
  v_rows_affected INT;
  v_void_event_count INT;
  v_original_event_count INT;
  v_void_doc_id UUID;
BEGIN
  -- ═══ 0. Fetch document ═══
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

  -- ═══ 3. Fetch snapshot for zone ═══
  SELECT * INTO v_snapshot FROM zone_stock_snapshots
  WHERE establishment_id = v_doc.establishment_id
    AND storage_zone_id = v_doc.storage_zone_id;

  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SNAPSHOT');
  END IF;

  -- ═══ 4. Count original events ═══
  SELECT COUNT(*) INTO v_original_event_count 
  FROM stock_events 
  WHERE document_id = p_document_id AND event_type != 'VOID';

  IF v_original_event_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_EVENTS_TO_VOID');
  END IF;

  -- ═══ 5. Mark original document as VOID ═══
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

  -- ═══ 6. Create void correction document (POSTED immediately) ═══
  INSERT INTO stock_documents (
    establishment_id, organization_id, storage_zone_id, supplier_id,
    type, status, created_by, posted_by, posted_at
  ) VALUES (
    v_doc.establishment_id, v_doc.organization_id, v_doc.storage_zone_id, v_doc.supplier_id,
    v_doc.type, 'POSTED', p_voided_by, p_voided_by, now()
  ) RETURNING id INTO v_void_doc_id;

  -- ═══ 7. INSERT inverse events (exact negation, round4) ═══
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

  -- ═══ 8. Verify balance (sum of original + void must = 0 per product) ═══
  -- This is a safety net — should always pass if inversion is correct
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
