-- ═══════════════════════════════════════════════════════════════════════════
-- STOCK ZÉRO SIMPLE V2 — Phase 3: Simplification fn_quick_adjustment
--
-- Supprime p_override_flag := true et p_override_reason.
-- Le moteur central gère le clamp universel.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_quick_adjustment(
  p_establishment_id UUID,
  p_organization_id UUID,
  p_storage_zone_id UUID,
  p_product_id UUID,
  p_target_qty NUMERIC,
  p_estimated_qty NUMERIC,
  p_canonical_unit_id UUID,
  p_canonical_family TEXT,
  p_canonical_label TEXT DEFAULT '',
  p_context_hash TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_delta NUMERIC;
  v_doc_id UUID;
  v_lock_version INT;
  v_idempotency_key TEXT;
  v_snapshot_exists BOOLEAN;
  v_post_result JSONB;
BEGIN
  v_delta := p_target_qty - p_estimated_qty;
  
  IF v_delta = 0 THEN
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM zone_stock_snapshots
    WHERE establishment_id = p_establishment_id
      AND storage_zone_id = p_storage_zone_id
  ) INTO v_snapshot_exists;

  IF NOT v_snapshot_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SNAPSHOT');
  END IF;

  INSERT INTO stock_documents (
    establishment_id, organization_id, storage_zone_id,
    type, status, created_by
  ) VALUES (
    p_establishment_id, p_organization_id, p_storage_zone_id,
    'ADJUSTMENT', 'DRAFT', p_user_id
  )
  RETURNING id, lock_version INTO v_doc_id, v_lock_version;

  INSERT INTO stock_document_lines (
    document_id, product_id, delta_quantity_canonical,
    canonical_unit_id, canonical_family, canonical_label,
    context_hash, input_payload
  ) VALUES (
    v_doc_id, p_product_id, v_delta,
    p_canonical_unit_id, p_canonical_family, p_canonical_label,
    COALESCE(p_context_hash, 'rpc-adjustment'),
    jsonb_build_object(
      'targetQty', p_target_qty,
      'estimatedQty', p_estimated_qty,
      'delta', v_delta,
      'source', 'fn_quick_adjustment'
    )
  );

  v_idempotency_key := md5(v_doc_id::text || p_establishment_id::text || v_lock_version::text);

  -- Stock Zéro Simple V2: pas d'override, le moteur central clamp à 0
  SELECT fn_post_stock_document(
    p_document_id := v_doc_id,
    p_expected_lock_version := v_lock_version,
    p_idempotency_key := v_idempotency_key,
    p_posted_by := p_user_id,
    p_event_reason := 'Correction manuelle (Centre de contrôle)'
  ) INTO v_post_result;

  IF NOT (v_post_result->>'ok')::boolean THEN
    RAISE EXCEPTION 'POST_FAILED: %', v_post_result->>'error';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'document_id', v_doc_id,
    'delta', v_delta,
    'events_created', v_post_result->'events_created'
  );
END;
$function$;