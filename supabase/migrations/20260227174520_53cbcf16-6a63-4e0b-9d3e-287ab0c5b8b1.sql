
CREATE OR REPLACE FUNCTION public.fn_post_stock_document(
  p_document_id UUID,
  p_expected_lock_version INT,
  p_posted_by UUID,
  p_idempotency_key TEXT DEFAULT NULL,
  p_event_reason TEXT DEFAULT NULL,
  p_override_flag BOOLEAN DEFAULT FALSE,
  p_override_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_doc RECORD;
  v_line RECORD;
  v_negative_products JSONB := '[]'::jsonb;
  v_event_id UUID;
  v_snapshot_id UUID;
  v_snapshot_version_id UUID;
  v_context_hash TEXT;
  v_event_count INT := 0;
BEGIN
  -- ═══ 1. FETCH + LOCK document ═══
  SELECT * INTO v_doc
  FROM stock_documents
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DOCUMENT_NOT_FOUND';
  END IF;

  -- ═══ 2. Idempotency check ═══
  IF v_doc.idempotency_key IS NOT NULL AND v_doc.idempotency_key = p_idempotency_key THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'document_id', p_document_id);
  END IF;

  -- ═══ 3. Status check ═══
  IF v_doc.status != 'DRAFT' THEN
    RAISE EXCEPTION 'NOT_DRAFT';
  END IF;

  -- ═══ 4. Lock version check ═══
  IF v_doc.lock_version != p_expected_lock_version THEN
    RAISE EXCEPTION 'LOCK_CONFLICT';
  END IF;

  -- ═══ 5. Lines check ═══
  IF NOT EXISTS (SELECT 1 FROM stock_document_lines WHERE document_id = p_document_id) THEN
    RAISE EXCEPTION 'NO_LINES';
  END IF;

  -- ═══ 6. Override reason check ═══
  IF p_override_flag = true AND (p_override_reason IS NULL OR trim(p_override_reason) = '') THEN
    RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED';
  END IF;

  -- ═══ 7. Validate all product zones have active snapshots ═══
  DECLARE
    v_missing_zone RECORD;
  BEGIN
    SELECT p.id AS product_id, p.storage_zone_id
    INTO v_missing_zone
    FROM stock_document_lines dl
    JOIN products_v2 p ON p.id = dl.product_id
    WHERE dl.document_id = p_document_id
      AND p.storage_zone_id IS NULL
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NO_ZONE';
    END IF;

    -- Check for missing snapshots
    DECLARE
      v_no_snap RECORD;
    BEGIN
      SELECT p.storage_zone_id
      INTO v_no_snap
      FROM stock_document_lines dl
      JOIN products_v2 p ON p.id = dl.product_id
      LEFT JOIN zone_stock_snapshots zss ON zss.storage_zone_id = p.storage_zone_id
        AND zss.establishment_id = v_doc.establishment_id
      WHERE dl.document_id = p_document_id
        AND zss.id IS NULL
      LIMIT 1;

      IF FOUND THEN
        RAISE EXCEPTION 'NO_ACTIVE_SNAPSHOT_FOR_PRODUCT_ZONE';
      END IF;
    END;
  END;

  -- ═══ 8. UPDATE document to POSTED ═══
  UPDATE stock_documents
  SET status = 'POSTED',
      lock_version = lock_version + 1,
      idempotency_key = p_idempotency_key,
      posted_by = p_posted_by,
      posted_at = now(),
      updated_at = now()
  WHERE id = p_document_id;

  -- ═══ 9. Negative stock check — PER PRODUCT ZONE (multi-zone safe) ═══
  IF p_override_flag = false THEN
    WITH line_with_zone AS (
      SELECT
        dl.product_id,
        dl.delta_quantity_canonical AS line_delta,
        p.storage_zone_id AS product_zone_id,
        p.name AS product_name
      FROM stock_document_lines dl
      JOIN products_v2 p ON p.id = dl.product_id
      WHERE dl.document_id = p_document_id
    ),
    zone_snapshots AS (
      SELECT zss.storage_zone_id, zss.id AS zss_id, zss.snapshot_version_id
      FROM zone_stock_snapshots zss
      WHERE zss.establishment_id = v_doc.establishment_id
    ),
    current_estimates AS (
      SELECT
        lz.product_id,
        lz.product_name,
        lz.line_delta,
        lz.product_zone_id,
        COALESCE(il.quantity, 0) AS snapshot_qty,
        COALESCE(ev_sum.total_delta, 0) AS events_delta
      FROM line_with_zone lz
      JOIN zone_snapshots zs ON zs.storage_zone_id = lz.product_zone_id
      LEFT JOIN inventory_lines il
        ON il.session_id = zs.snapshot_version_id
        AND il.product_id = lz.product_id
      LEFT JOIN (
        SELECT se.product_id, se.storage_zone_id, SUM(se.delta_quantity_canonical) AS total_delta
        FROM stock_events se
        JOIN zone_snapshots zs2 ON zs2.storage_zone_id = se.storage_zone_id
        WHERE se.snapshot_version_id = zs2.zss_id
        GROUP BY se.product_id, se.storage_zone_id
      ) ev_sum ON ev_sum.product_id = lz.product_id AND ev_sum.storage_zone_id = lz.product_zone_id
    ),
    negatives AS (
      SELECT
        product_id, product_name, snapshot_qty, events_delta, line_delta, product_zone_id,
        ROUND((snapshot_qty + events_delta + line_delta)::numeric, 4) AS resulting_stock
      FROM current_estimates
      WHERE ROUND((snapshot_qty + events_delta + line_delta)::numeric, 4) < 0
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'product_id', product_id,
        'product_name', product_name,
        'current_estimated', ROUND((snapshot_qty + events_delta)::numeric, 4),
        'delta', line_delta,
        'resulting_stock', resulting_stock,
        'zone_id', product_zone_id
      )
    ), '[]'::jsonb) INTO v_negative_products FROM negatives;

    IF v_negative_products != '[]'::jsonb THEN
      -- Rollback the status update
      UPDATE stock_documents
      SET status = 'DRAFT',
          lock_version = p_expected_lock_version,
          idempotency_key = NULL,
          posted_by = NULL,
          posted_at = NULL,
          updated_at = now()
      WHERE id = p_document_id;

      RAISE EXCEPTION 'NEGATIVE_STOCK:%', v_negative_products::text;
    END IF;
  END IF;

  -- ═══ 10. INSERT stock_events — ROUTED BY PRODUCT ZONE ═══
  FOR v_line IN
    SELECT
      dl.id AS line_id,
      dl.product_id,
      dl.delta_quantity_canonical,
      dl.canonical_unit_id,
      p.storage_zone_id AS product_zone_id
    FROM stock_document_lines dl
    JOIN products_v2 p ON p.id = dl.product_id
    WHERE dl.document_id = p_document_id
  LOOP
    -- Get the zone snapshot for this product's zone
    SELECT zss.id, zss.snapshot_version_id
    INTO v_snapshot_id, v_snapshot_version_id
    FROM zone_stock_snapshots zss
    WHERE zss.storage_zone_id = v_line.product_zone_id
      AND zss.establishment_id = v_doc.establishment_id;

    -- Context hash (FNV-1a style placeholder — simple hash)
    v_context_hash := md5(
      v_line.product_id::text ||
      v_line.canonical_unit_id::text ||
      v_snapshot_id::text ||
      v_snapshot_version_id::text
    );

    INSERT INTO stock_events (
      document_id,
      document_line_id,
      document_type,
      product_id,
      storage_zone_id,
      delta_quantity_canonical,
      canonical_unit_id,
      snapshot_id,
      snapshot_version_id,
      context_hash,
      establishment_id,
      event_reason,
      override_flag,
      override_reason
    ) VALUES (
      p_document_id,
      v_line.line_id,
      v_doc.document_type,
      v_line.product_id,
      v_line.product_zone_id,
      v_line.delta_quantity_canonical,
      v_line.canonical_unit_id,
      v_snapshot_id,
      v_snapshot_version_id,
      v_context_hash,
      v_doc.establishment_id,
      p_event_reason,
      p_override_flag,
      p_override_reason
    );

    v_event_count := v_event_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'document_id', p_document_id,
    'events_created', v_event_count,
    'new_lock_version', v_doc.lock_version + 1
  );
END;
$$;
