
-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: Drop broken 7-param overload and recreate with correct column names
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the broken 7-param overload (wrong column names: zone_id, is_active, idempotency_key, created_by)
DROP FUNCTION IF EXISTS public.fn_post_stock_document(uuid, integer, uuid, text, boolean, text, text);

-- Recreate with correct column names matching actual schema
CREATE OR REPLACE FUNCTION public.fn_post_stock_document(
  p_document_id uuid,
  p_expected_lock_version integer,
  p_posted_by uuid,
  p_idempotency_key text,
  p_override_flag boolean DEFAULT false,
  p_override_reason text DEFAULT NULL::text,
  p_event_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_doc RECORD;
  v_line RECORD;
  v_snapshot RECORD;
  v_rows_updated INTEGER;
  v_events_created INTEGER := 0;
  v_negative_products JSONB := '[]'::JSONB;
  v_current_stock NUMERIC;
  v_resulting_stock NUMERIC;
  v_effective_reason TEXT;
BEGIN
  -- ═══ 0. Idempotency check (via stock_documents.idempotency_key) ═══
  IF EXISTS (
    SELECT 1 FROM stock_documents 
    WHERE idempotency_key = p_idempotency_key 
      AND status = 'POSTED'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'events_created', 0);
  END IF;

  -- ═══ 1. Load & validate document ═══
  SELECT * INTO v_doc FROM stock_documents WHERE id = p_document_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DOCUMENT_NOT_FOUND');
  END IF;

  IF v_doc.status <> 'DRAFT' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_DRAFT');
  END IF;

  -- ═══ 1b. STRICT reason validation for WITHDRAWAL ═══
  IF v_doc.type = 'WITHDRAWAL' THEN
    IF p_event_reason IS NULL OR TRIM(p_event_reason) = '' THEN
      RAISE EXCEPTION 'WITHDRAWAL_REASON_REQUIRED: Le motif est obligatoire pour un retrait.';
    END IF;
  END IF;

  v_effective_reason := NULLIF(TRIM(p_event_reason), '');

  -- ═══ 2. Check active snapshot (correct column: storage_zone_id) ═══
  SELECT * INTO v_snapshot 
  FROM zone_stock_snapshots 
  WHERE storage_zone_id = v_doc.storage_zone_id
  ORDER BY activated_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SNAPSHOT');
  END IF;

  -- ═══ 3. Check lines exist ═══
  IF NOT EXISTS (SELECT 1 FROM stock_document_lines WHERE document_id = p_document_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LINES');
  END IF;

  -- ═══ 4. Override reason check ═══
  IF p_override_flag AND (p_override_reason IS NULL OR TRIM(p_override_reason) = '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OVERRIDE_REASON_REQUIRED');
  END IF;

  -- ═══ 5. Negative stock pre-check (unless override) ═══
  IF NOT p_override_flag THEN
    FOR v_line IN SELECT * FROM stock_document_lines WHERE document_id = p_document_id LOOP
      SELECT COALESCE(SUM(delta_quantity_canonical), 0) INTO v_current_stock
      FROM stock_events
      WHERE storage_zone_id = v_doc.storage_zone_id
        AND product_id = v_line.product_id
        AND snapshot_version_id = v_snapshot.id;

      v_resulting_stock := v_current_stock + v_line.delta_quantity_canonical;

      IF v_resulting_stock < 0 THEN
        v_negative_products := v_negative_products || jsonb_build_object(
          'product_id', v_line.product_id,
          'current_estimated', v_current_stock,
          'delta', v_line.delta_quantity_canonical,
          'resulting_stock', v_resulting_stock
        );
      END IF;
    END LOOP;

    IF jsonb_array_length(v_negative_products) > 0 THEN
      RAISE EXCEPTION 'NEGATIVE_STOCK:%', v_negative_products::TEXT;
    END IF;
  END IF;

  -- ═══ 6. Atomic lock: update document status ═══
  UPDATE stock_documents
  SET status = 'POSTED',
      posted_at = now(),
      posted_by = p_posted_by,
      idempotency_key = p_idempotency_key,
      lock_version = lock_version + 1,
      updated_at = now()
  WHERE id = p_document_id
    AND status = 'DRAFT'
    AND lock_version = p_expected_lock_version;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LOCK_CONFLICT');
  END IF;

  -- ═══ 7. Insert ledger events (correct columns) ═══
  FOR v_line IN SELECT * FROM stock_document_lines WHERE document_id = p_document_id LOOP
    INSERT INTO stock_events (
      establishment_id,
      organization_id,
      storage_zone_id,
      product_id,
      document_id,
      event_type,
      event_reason,
      delta_quantity_canonical,
      canonical_unit_id,
      canonical_family,
      canonical_label,
      context_hash,
      snapshot_version_id,
      override_flag,
      override_reason,
      posted_by
    ) VALUES (
      v_doc.establishment_id,
      v_doc.organization_id,
      v_doc.storage_zone_id,
      v_line.product_id,
      p_document_id,
      v_doc.type::text::stock_event_type,
      v_effective_reason,
      v_line.delta_quantity_canonical,
      v_line.canonical_unit_id,
      v_line.canonical_family,
      v_line.canonical_label,
      v_line.context_hash,
      v_snapshot.id,
      p_override_flag,
      NULLIF(TRIM(p_override_reason), ''),
      p_posted_by
    );

    v_events_created := v_events_created + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'events_created', v_events_created);
END;
$function$;
