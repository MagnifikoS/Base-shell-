
-- Fix: ambiguous column reference 'original_event_id' in fn_void_stock_document
-- The CTE 'clamped_voids' selects cs.original_event_id AND oe.* (which also has original_event_id)
-- Solution: replace oe.* with explicit columns, excluding original_event_id

CREATE OR REPLACE FUNCTION public.fn_void_stock_document(p_document_id uuid, p_voided_by uuid, p_void_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      'error', 'MISSING_ZONE_SNAPSHOTS',
      'zones', v_missing_snapshot_zones,
      'message', 'Certaines zones n''ont pas de snapshot. Effectuez un inventaire avant d''annuler.'
    );
  END IF;

  -- ═══ 7. Void original document ═══
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
  -- FIX: replaced oe.* with explicit columns to avoid ambiguous original_event_id
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
      oe.establishment_id,
      oe.organization_id,
      oe.storage_zone_id,
      oe.product_id,
      oe.canonical_unit_id,
      oe.canonical_family,
      oe.canonical_label,
      oe.context_hash,
      oe.snapshot_version_id,
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
    'voided_document_id', p_document_id,
    'void_correction_document_id', v_void_doc_id,
    'original_events', v_original_event_count,
    'void_events_created', v_void_event_count
  );
END;
$function$;
