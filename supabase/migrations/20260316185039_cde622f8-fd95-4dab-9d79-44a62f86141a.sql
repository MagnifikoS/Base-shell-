-- ═══════════════════════════════════════════════════════════════════════════
-- FIX REGRESSION: Restore P0-1 mapping RECEIPT_CORRECTION → ADJUSTMENT
-- Migration 20260311103639 overwrote fn_post_stock_document without the P0-1 fix.
-- This restores the correct event_type resolution from 20260216150025.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_post_stock_document(
  p_document_id UUID,
  p_expected_lock_version INT,
  p_idempotency_key TEXT DEFAULT NULL,
  p_posted_by UUID DEFAULT NULL,
  p_event_reason TEXT DEFAULT NULL,
  p_override_flag BOOLEAN DEFAULT false,
  p_override_reason TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_doc RECORD;
  v_rows_affected INT;
  v_event_count INT;
  v_line_count INT;
  v_incomplete_count INT;
  v_negative_products JSONB;
  v_event_reason TEXT;
  v_event_type stock_event_type;
  v_missing_zone_products JSONB;
  v_missing_snapshot_zones JSONB;
  v_warnings JSONB := '[]'::jsonb;
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

  -- ═══ 3. Resolve event_reason AND event_type ═══
  -- P0-1: RECEIPT_CORRECTION documents produce ADJUSTMENT events with reason RECEIPT_CORRECTION
  IF v_doc.type = 'RECEIPT_CORRECTION' THEN
    v_event_type := 'ADJUSTMENT';
    v_event_reason := COALESCE(NULLIF(TRIM(p_event_reason), ''), 'RECEIPT_CORRECTION');
  ELSIF v_doc.type = 'WITHDRAWAL' THEN
    IF p_event_reason IS NULL OR TRIM(p_event_reason) = '' THEN
      RAISE EXCEPTION 'WITHDRAWAL_REASON_REQUIRED: Le motif est obligatoire pour un retrait.';
    END IF;
    v_event_type := 'WITHDRAWAL';
    v_event_reason := TRIM(p_event_reason);
  ELSIF v_doc.type = 'RECEIPT' THEN
    v_event_type := 'RECEIPT';
    v_event_reason := COALESCE(NULLIF(TRIM(p_event_reason), ''), 'RECEIPT');
  ELSIF v_doc.type = 'ADJUSTMENT' THEN
    v_event_type := 'ADJUSTMENT';
    v_event_reason := COALESCE(NULLIF(TRIM(p_event_reason), ''), 'ADJUSTMENT_MANUAL');
  ELSE
    v_event_type := 'ADJUSTMENT';
    v_event_reason := COALESCE(NULLIF(TRIM(p_event_reason), ''), v_doc.type::text);
  END IF;

  -- ═══ 4. Must have lines ═══
  SELECT COUNT(*) INTO v_line_count FROM stock_document_lines WHERE document_id = p_document_id;
  IF v_line_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LINES');
  END IF;

  -- ═══ 5. Line completeness guard ═══
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

  -- ═══ 6. Per-product snapshot validation with FOR UPDATE lock ═══
  PERFORM zss.id
  FROM stock_document_lines dl
  JOIN products_v2 p ON p.id = dl.product_id
  JOIN zone_stock_snapshots zss 
    ON zss.establishment_id = v_doc.establishment_id
    AND zss.storage_zone_id = COALESCE(p.storage_zone_id, v_doc.storage_zone_id)
  WHERE dl.document_id = p_document_id
  FOR UPDATE OF zss;

  -- Check for lines whose product zone has NO snapshot
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', dl.product_id,
    'product_name', p.nom_produit,
    'zone_id', COALESCE(p.storage_zone_id, v_doc.storage_zone_id)
  )), '[]'::jsonb)
  INTO v_missing_snapshot_zones
  FROM stock_document_lines dl
  JOIN products_v2 p ON p.id = dl.product_id
  WHERE dl.document_id = p_document_id
    AND NOT EXISTS (
      SELECT 1 FROM zone_stock_snapshots zss
      WHERE zss.establishment_id = v_doc.establishment_id
        AND zss.storage_zone_id = COALESCE(p.storage_zone_id, v_doc.storage_zone_id)
    );

  IF v_missing_snapshot_zones != '[]'::jsonb THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'NO_ACTIVE_SNAPSHOT_FOR_PRODUCT_ZONE',
      'zones', v_missing_snapshot_zones,
      'message', 'Snapshot actif manquant pour certaines zones de produits.'
    );
  END IF;

  -- ═══ 6b. P0 BLOCAGE DUR: Produits sans zone assignée ═══
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', dl.product_id,
    'product_name', p.nom_produit
  )), '[]'::jsonb)
  INTO v_missing_zone_products
  FROM stock_document_lines dl
  JOIN products_v2 p ON p.id = dl.product_id
  WHERE dl.document_id = p_document_id
    AND p.storage_zone_id IS NULL;

  IF v_missing_zone_products != '[]'::jsonb THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'PRODUCT_NO_ZONE',
      'products', v_missing_zone_products,
      'message', 'Produit(s) sans zone de stockage assignée.'
    );
  END IF;

  -- ═══ 6c. RECEIPT/RECEIPT_CORRECTION: generate multi-zone warning ═══
  IF v_doc.type IN ('RECEIPT', 'RECEIPT_CORRECTION') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', dl.product_id,
      'product_name', p.nom_produit,
      'product_zone_id', p.storage_zone_id,
      'product_zone_name', COALESCE(sz.name, p.storage_zone_id::text),
      'document_zone_id', v_doc.storage_zone_id
    )), '[]'::jsonb)
    INTO v_warnings
    FROM stock_document_lines dl
    JOIN products_v2 p ON p.id = dl.product_id
    LEFT JOIN storage_zones sz ON sz.id = p.storage_zone_id
    WHERE dl.document_id = p_document_id
      AND p.storage_zone_id IS NOT NULL
      AND p.storage_zone_id != v_doc.storage_zone_id;
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

  -- ═══ 9. Negative stock check — PER PRODUCT ZONE ═══
  IF p_override_flag = false THEN
    WITH line_with_zone AS (
      SELECT
        dl.product_id,
        dl.delta_quantity_canonical AS line_delta,
        COALESCE(p.storage_zone_id, v_doc.storage_zone_id) AS product_zone_id
      FROM stock_document_lines dl
      JOIN products_v2 p ON p.id = dl.product_id
      WHERE dl.document_id = p_document_id
    ),
    zone_snapshots AS (
      SELECT zss.storage_zone_id, zss.snapshot_version_id
      FROM zone_stock_snapshots zss
      WHERE zss.establishment_id = v_doc.establishment_id
    ),
    current_estimates AS (
      SELECT
        lz.product_id,
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
        WHERE se.snapshot_version_id = zs2.snapshot_version_id
        GROUP BY se.product_id, se.storage_zone_id
      ) ev_sum ON ev_sum.product_id = lz.product_id AND ev_sum.storage_zone_id = lz.product_zone_id
    ),
    negatives AS (
      SELECT 
        product_id, snapshot_qty, events_delta, line_delta, product_zone_id,
        ROUND((snapshot_qty + events_delta + line_delta)::numeric, 4) AS resulting_stock
      FROM current_estimates
      WHERE ROUND((snapshot_qty + events_delta + line_delta)::numeric, 4) < 0
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'product_id', product_id, 
        'current_estimated', ROUND((snapshot_qty + events_delta)::numeric, 4),
        'delta', line_delta, 
        'resulting_stock', resulting_stock,
        'zone_id', product_zone_id
      )
    ), '[]'::jsonb) INTO v_negative_products FROM negatives;

    IF v_negative_products != '[]'::jsonb THEN
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
  -- P0-1: Use v_event_type (resolved in step 3) instead of raw doc type cast
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
    COALESCE(p.storage_zone_id, v_doc.storage_zone_id),
    dl.product_id,
    p_document_id,
    v_event_type,              -- ← RESOLVED event type (ADJUSTMENT for RECEIPT_CORRECTION)
    v_event_reason,
    dl.delta_quantity_canonical,
    dl.canonical_unit_id,
    dl.canonical_family,
    dl.canonical_label,
    dl.context_hash,
    zss.snapshot_version_id,
    p_override_flag,
    p_override_reason,
    p_posted_by
  FROM stock_document_lines dl
  JOIN products_v2 p ON p.id = dl.product_id
  JOIN zone_stock_snapshots zss 
    ON zss.establishment_id = v_doc.establishment_id 
    AND zss.storage_zone_id = COALESCE(p.storage_zone_id, v_doc.storage_zone_id)
  WHERE dl.document_id = p_document_id;

  GET DIAGNOSTICS v_event_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'document_id', p_document_id,
    'events_created', v_event_count,
    'new_lock_version', p_expected_lock_version + 1,
    'warnings', v_warnings
  );
END;
$function$;