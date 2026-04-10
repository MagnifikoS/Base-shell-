
-- Fix fn_transfer_product_zone: use INIT_AFTER_SNAPSHOT as created_via
-- to comply with the terminated_session_guard trigger
DROP FUNCTION IF EXISTS public.fn_transfer_product_zone(UUID, UUID, UUID, NUMERIC, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_transfer_product_zone(
  p_product_id UUID,
  p_new_zone_id UUID,
  p_user_id UUID,
  p_estimated_qty NUMERIC,
  p_canonical_unit_id UUID,
  p_canonical_family TEXT,
  p_context_hash TEXT
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
  v_withdrawal_doc_id UUID;
  v_receipt_doc_id UUID;
  v_snapshot_version_id UUID;
  v_canonical_label TEXT;
  v_post_result JSONB;
  v_idempotency_key TEXT;
  v_context_hash TEXT;
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

  IF p_estimated_qty > 0 AND v_old_zone_id IS NOT NULL AND p_canonical_unit_id IS NOT NULL THEN

    v_idempotency_key := 'zone-transfer-w-' || p_product_id || '-' || extract(epoch from now())::text;
    INSERT INTO stock_documents (
      establishment_id, organization_id, storage_zone_id, type, status, created_by, idempotency_key
    ) VALUES (
      v_est_id, v_org_id, v_old_zone_id, 'WITHDRAWAL', 'DRAFT', p_user_id, v_idempotency_key
    ) RETURNING id INTO v_withdrawal_doc_id;

    INSERT INTO stock_document_lines (
      document_id, product_id, delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label, context_hash
    ) VALUES (
      v_withdrawal_doc_id, p_product_id, -1 * p_estimated_qty, p_canonical_unit_id, p_canonical_family, v_canonical_label, v_context_hash
    );

    v_post_result := fn_post_stock_document(
      p_document_id := v_withdrawal_doc_id,
      p_expected_lock_version := 0,
      p_posted_by := p_user_id::text,
      p_event_reason := 'Transfert zone : retrait (de ' || v_old_zone_id::text || ')'
    );

    IF NOT (v_post_result->>'ok')::boolean THEN
      RAISE EXCEPTION 'WITHDRAWAL_POST_FAILED: %', v_post_result->>'error';
    END IF;

    v_idempotency_key := 'zone-transfer-r-' || p_product_id || '-' || extract(epoch from now())::text;
    INSERT INTO stock_documents (
      establishment_id, organization_id, storage_zone_id, type, status, created_by, idempotency_key
    ) VALUES (
      v_est_id, v_org_id, p_new_zone_id, 'RECEIPT', 'DRAFT', p_user_id, v_idempotency_key
    ) RETURNING id INTO v_receipt_doc_id;

    INSERT INTO stock_document_lines (
      document_id, product_id, delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label, context_hash
    ) VALUES (
      v_receipt_doc_id, p_product_id, p_estimated_qty, p_canonical_unit_id, p_canonical_family, v_canonical_label, v_context_hash
    );

    v_post_result := fn_post_stock_document(
      p_document_id := v_receipt_doc_id,
      p_expected_lock_version := 0,
      p_posted_by := p_user_id::text,
      p_event_reason := 'Transfert zone : réception (vers ' || p_new_zone_id::text || ')'
    );

    IF NOT (v_post_result->>'ok')::boolean THEN
      RAISE EXCEPTION 'RECEIPT_POST_FAILED: %', v_post_result->>'error';
    END IF;
  END IF;

  -- Initialize snapshot line in new zone (qty=0)
  -- Use INIT_AFTER_SNAPSHOT to comply with terminated_session_guard trigger
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
    'transferred_qty', p_estimated_qty,
    'old_zone_id', v_old_zone_id,
    'new_zone_id', p_new_zone_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
