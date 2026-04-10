
-- ═══ STEP 1: Drop BOTH overloads (different parameter orders) ═══
DROP FUNCTION IF EXISTS public.fn_post_stock_document(
  p_document_id uuid, p_expected_lock_version integer, 
  p_posted_by uuid, p_idempotency_key text, 
  p_override_flag boolean, p_override_reason text, p_event_reason text
);

DROP FUNCTION IF EXISTS public.fn_post_stock_document(
  p_document_id uuid, p_expected_lock_version integer, 
  p_idempotency_key text, p_posted_by uuid, 
  p_event_reason text, p_override_flag boolean, p_override_reason text
);

-- ═══ STEP 2: Recreate ONE canonical signature ═══
-- Order: document_id, lock_version, idempotency_key, posted_by, event_reason, override_flag, override_reason
CREATE FUNCTION public.fn_post_stock_document(
  p_document_id UUID,
  p_expected_lock_version INT,
  p_idempotency_key TEXT DEFAULT NULL,
  p_posted_by UUID DEFAULT NULL,
  p_event_reason TEXT DEFAULT NULL,
  p_override_flag BOOLEAN DEFAULT false,
  p_override_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc RECORD;
  v_snapshot RECORD;
  v_rows_affected INT;
  v_event_count INT;
  v_line_count INT;
  v_incomplete_count INT;
  v_negative_products JSONB;
  v_event_reason TEXT;
BEGIN
  -- ═══ 0. Fetch document ═══
  SELECT * INTO v_doc FROM stock_documents WHERE id = p_document_id;
  IF v_doc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DOCUMENT_NOT_FOUND');
  END IF;

  -- ═══ 1. Idempotency ═══
  IF v_doc.status = 'POSTED' AND v_doc.idempotency_key IS NOT NULL 
     AND v_doc.idempotency_key = p_idempotency_key THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'document_id', p_document_id);
  END IF;

  -- ═══ 2. Must be DRAFT ═══
  IF v_doc.status != 'DRAFT' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_DRAFT', 'current_status', v_doc.status::text);
  END IF;

  -- ═══ 3. Resolve event_reason (NEVER NULL) ═══
  IF v_doc.type = 'WITHDRAWAL' THEN
    IF p_event_reason IS NULL OR TRIM(p_event_reason) = '' THEN
      RAISE EXCEPTION 'WITHDRAWAL_REASON_REQUIRED: Le motif est obligatoire pour un retrait.';
    END IF;
    v_event_reason := TRIM(p_event_reason);
  ELSIF v_doc.type = 'RECEIPT' THEN
    v_event_reason := COALESCE(NULLIF(TRIM(p_event_reason), ''), 'RECEIPT');
  ELSIF v_doc.type = 'ADJUSTMENT' THEN
    v_event_reason := COALESCE(NULLIF(TRIM(p_event_reason), ''), 'ADJUSTMENT_MANUAL');
  ELSE
    v_event_reason := COALESCE(NULLIF(TRIM(p_event_reason), ''), v_doc.type::text);
  END IF;

  -- ═══ 4. Snapshot must exist for zone ═══
  SELECT * INTO v_snapshot FROM zone_stock_snapshots
  WHERE establishment_id = v_doc.establishment_id
    AND storage_zone_id = v_doc.storage_zone_id;

  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SNAPSHOT', 
      'zone_id', v_doc.storage_zone_id);
  END IF;

  -- ═══ 5. Must have lines ═══
  SELECT COUNT(*) INTO v_line_count FROM stock_document_lines WHERE document_id = p_document_id;
  IF v_line_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LINES');
  END IF;

  -- ═══ 6. Line completeness guard ═══
  SELECT COUNT(*) INTO v_incomplete_count
  FROM stock_document_lines
  WHERE document_id = p_document_id
    AND (
      delta_quantity_canonical IS NULL
      OR canonical_unit_id IS NULL
      OR canonical_family IS NULL
      OR context_hash IS NULL
    );

  IF v_incomplete_count > 0 THEN
    RAISE EXCEPTION 'LINE_INCOMPLETE_CANONICAL_DATA: % ligne(s) avec données canoniques manquantes.', v_incomplete_count;
  END IF;

  -- ═══ 7. Override validation ═══
  IF p_override_flag = true AND (p_override_reason IS NULL OR TRIM(p_override_reason) = '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OVERRIDE_REASON_REQUIRED');
  END IF;

  -- ═══ 8. ATOMIC UPDATE with lock_version check ═══
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

  -- ═══ 9. Negative stock check ═══
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
          AND snapshot_version_id = v_snapshot.snapshot_version_id
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

    IF v_negative_products != '[]'::jsonb THEN
      RAISE EXCEPTION 'NEGATIVE_STOCK:%', v_negative_products::text;
    END IF;
  END IF;

  -- ═══ 10. INSERT stock_events ═══
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
    v_event_reason,
    dl.delta_quantity_canonical,
    dl.canonical_unit_id,
    dl.canonical_family,
    dl.canonical_label,
    dl.context_hash,
    v_snapshot.snapshot_version_id,
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
    'snapshot_version_id', v_snapshot.snapshot_version_id,
    'new_lock_version', p_expected_lock_version + 1
  );
END;
$$;
