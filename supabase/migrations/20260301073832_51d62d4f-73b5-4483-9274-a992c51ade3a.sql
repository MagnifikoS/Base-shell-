
-- ═══════════════════════════════════════════════════════════════════════════
-- fn_receive_order: Atomic reception (RECEIPT DRAFT → POST → BL Reception → order status)
-- Idempotent: if order is already received, returns success without side effects
-- Concurrency: checks status = 'shipped' with FOR UPDATE lock
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_receive_order(
  p_order_id UUID,
  p_user_id UUID,
  p_lines JSONB  -- array of {product_id, quantity_received, canonical_unit_id, product_name_snapshot}
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_org_id UUID;
  v_est_id UUID;
  v_header_zone_id UUID;
  v_doc_id UUID;
  v_lock_version INT;
  v_bl_id UUID;
  v_bl_number TEXT;
  v_line JSONB;
  v_product RECORD;
  v_unit RECORD;
  v_idem_key TEXT;
  v_existing_doc_id UUID;
  v_dest_name TEXT;
  v_added INT := 0;
BEGIN
  -- 1. Lock order and validate
  SELECT * INTO v_order
  FROM product_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  -- Idempotency: already received
  IF v_order.status IN ('received', 'closed') AND v_order.bl_reception_document_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'bl_reception_document_id', v_order.bl_reception_document_id);
  END IF;

  -- Concurrency guard
  IF v_order.status != 'shipped' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STATUS_CONFLICT', 'current_status', v_order.status, 'expected', 'shipped');
  END IF;

  v_est_id := v_order.source_establishment_id;  -- restaurant receives
  v_org_id := v_order.organization_id;
  v_idem_key := 'receive-order-' || p_order_id::text;

  -- Get supplier name for BL
  SELECT name INTO v_dest_name FROM establishments WHERE id = v_order.destination_establishment_id;

  -- Check idempotency via existing stock document
  SELECT id INTO v_existing_doc_id
  FROM stock_documents
  WHERE idempotency_key = v_idem_key AND status = 'POSTED';

  IF v_existing_doc_id IS NOT NULL THEN
    SELECT id INTO v_bl_id FROM bl_app_documents WHERE stock_document_id = v_existing_doc_id LIMIT 1;
    UPDATE product_orders SET status = 'received', bl_reception_document_id = v_bl_id WHERE id = p_order_id;
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'bl_reception_document_id', v_bl_id);
  END IF;

  -- 2. Find header zone
  SELECT p.storage_zone_id INTO v_header_zone_id
  FROM jsonb_array_elements(p_lines) AS el
  JOIN products_v2 p ON p.id = (el->>'product_id')::uuid
  WHERE p.storage_zone_id IS NOT NULL
  LIMIT 1;

  IF v_header_zone_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_STORAGE_ZONE');
  END IF;

  -- 3. Abandon existing DRAFTs
  UPDATE stock_documents
  SET status = 'ABANDONED'
  WHERE establishment_id = v_est_id
    AND storage_zone_id = v_header_zone_id
    AND type = 'RECEIPT'
    AND status = 'DRAFT';

  -- 4. Create RECEIPT document
  INSERT INTO stock_documents (establishment_id, organization_id, storage_zone_id, type, status, created_by, source_order_id, idempotency_key)
  VALUES (v_est_id, v_org_id, v_header_zone_id, 'RECEIPT', 'DRAFT', p_user_id, p_order_id, v_idem_key)
  RETURNING id, lock_version INTO v_doc_id, v_lock_version;

  -- 5. Add lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    IF (v_line->>'quantity_received')::numeric <= 0 THEN CONTINUE; END IF;

    SELECT p.id, p.storage_zone_id, p.supplier_billing_unit_id
    INTO v_product
    FROM products_v2 p
    WHERE p.id = (v_line->>'product_id')::uuid;

    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT mu.id, mu.family, mu.abbreviation, mu.name
    INTO v_unit
    FROM measurement_units mu
    WHERE mu.id = (v_line->>'canonical_unit_id')::uuid;

    IF NOT FOUND OR v_unit.family IS NULL THEN CONTINUE; END IF;

    INSERT INTO stock_document_lines (document_id, product_id, delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label, context_hash, input_payload)
    VALUES (
      v_doc_id,
      v_product.id,
      ABS((v_line->>'quantity_received')::numeric),
      v_unit.id,
      v_unit.family,
      COALESCE(v_unit.abbreviation, v_unit.name),
      'recv-' || p_order_id::text,
      jsonb_build_object('product_name', v_line->>'product_name_snapshot')
    );
    v_added := v_added + 1;
  END LOOP;

  IF v_added = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LINES_TO_RECEIVE');
  END IF;

  -- 6. POST
  DECLARE
    v_post_result JSONB;
  BEGIN
    v_post_result := fn_post_stock_document(
      p_document_id := v_doc_id,
      p_expected_lock_version := v_lock_version,
      p_event_reason := 'RECEIPT'
    );

    IF NOT (v_post_result->>'ok')::boolean THEN
      RAISE EXCEPTION 'POST_FAILED: %', v_post_result->>'error';
    END IF;
  END;

  -- 7. Create BL Reception
  v_bl_number := 'REC-CMD-' || UPPER(LEFT(p_order_id::text, 6));

  INSERT INTO bl_app_documents (establishment_id, stock_document_id, supplier_name_snapshot, bl_number, bl_date, status)
  VALUES (v_est_id, v_doc_id, v_dest_name, v_bl_number, CURRENT_DATE, 'FINAL')
  RETURNING id INTO v_bl_id;

  -- Insert BL reception lines
  INSERT INTO bl_app_lines (bl_app_document_id, establishment_id, product_id, product_name_snapshot, quantity_canonical, canonical_unit_id)
  SELECT v_bl_id,
         v_est_id,
         (el->>'product_id')::uuid,
         el->>'product_name_snapshot',
         ABS((el->>'quantity_received')::numeric),
         (el->>'canonical_unit_id')::uuid
  FROM jsonb_array_elements(p_lines) AS el
  WHERE (el->>'quantity_received')::numeric > 0;

  -- 8. Update order + line quantities
  UPDATE product_orders
  SET status = 'received',
      bl_reception_document_id = v_bl_id
  WHERE id = p_order_id;

  -- Update quantity_received on order lines
  UPDATE product_order_lines pol
  SET quantity_received = (el->>'quantity_received')::numeric
  FROM jsonb_array_elements(p_lines) AS el
  WHERE pol.order_id = p_order_id
    AND pol.product_id = (el->>'product_id')::uuid;

  RETURN jsonb_build_object('ok', true, 'bl_reception_document_id', v_bl_id, 'stock_document_id', v_doc_id);
END;
$$;
