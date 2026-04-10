
-- ═══════════════════════════════════════════════════════════════════════════
-- B2B REFONTE: Add shipped_at + awaiting_client_validation support
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add shipped_at timestamp to product_orders (for 24h auto-validation)
ALTER TABLE public.product_orders 
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Add stock_document_id to bl_withdrawal_documents if missing (for DRAFT tracking)
-- Already exists per types.ts, skip.

-- 3. Create the atomic B2B reception RPC
CREATE OR REPLACE FUNCTION public.fn_post_b2b_reception(
  p_order_id UUID,
  p_validated_lines JSONB, -- array of { supplier_product_id, client_product_id, quantity_canonical, client_canonical_unit_id, client_canonical_family, client_canonical_label, client_context_hash }
  p_client_user_id UUID,
  p_client_establishment_id UUID,
  p_client_organization_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_bl_retrait RECORD;
  v_stock_doc RECORD;
  v_supplier_est RECORD;
  v_post_result JSONB;
  v_receipt_doc_id UUID;
  v_receipt_event_count INT;
  v_bl_reception_id UUID;
  v_client_header_zone_id UUID;
  v_line JSONB;
  v_line_count INT := 0;
  v_total_eur NUMERIC(12,2) := 0;
BEGIN
  -- ═══ 0. Validate order ═══
  SELECT * INTO v_order FROM product_orders WHERE id = p_order_id;
  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  
  IF v_order.status != 'awaiting_client_validation' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATUS', 'current_status', v_order.status);
  END IF;
  
  IF v_order.source_establishment_id != p_client_establishment_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_CLIENT_ESTABLISHMENT');
  END IF;

  -- ═══ 1. Get BL Retrait DRAFT ═══
  IF v_order.bl_retrait_document_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_BL_RETRAIT');
  END IF;
  
  SELECT * INTO v_bl_retrait 
  FROM bl_withdrawal_documents 
  WHERE id = v_order.bl_retrait_document_id;
  
  IF v_bl_retrait IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BL_RETRAIT_NOT_FOUND');
  END IF;

  -- ═══ 2. Get stock document (must be DRAFT) ═══
  SELECT * INTO v_stock_doc 
  FROM stock_documents 
  WHERE id = v_bl_retrait.stock_document_id;
  
  IF v_stock_doc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STOCK_DOC_NOT_FOUND');
  END IF;
  
  IF v_stock_doc.status != 'DRAFT' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STOCK_DOC_NOT_DRAFT', 'current_status', v_stock_doc.status);
  END IF;

  -- ═══ 3. Get supplier establishment info ═══
  SELECT id, organization_id INTO v_supplier_est 
  FROM establishments 
  WHERE id = v_order.destination_establishment_id;

  -- ═══ 4. POST the supplier's WITHDRAWAL stock document ═══
  -- Use the existing fn_post_stock_document to maintain consistency
  v_post_result := fn_post_stock_document(
    p_document_id := v_stock_doc.id,
    p_expected_lock_version := v_stock_doc.lock_version,
    p_idempotency_key := 'b2b-reception-' || p_order_id::text || '-' || v_stock_doc.lock_version::text,
    p_posted_by := p_client_user_id,
    p_event_reason := 'INTER_ESTABLISHMENT_TRANSFER',
    p_override_flag := false,
    p_override_reason := NULL
  );
  
  IF NOT (v_post_result->>'ok')::boolean THEN
    RETURN jsonb_build_object(
      'ok', false, 
      'error', 'SUPPLIER_POST_FAILED', 
      'details', v_post_result
    );
  END IF;

  -- ═══ 5. Update BL Retrait lines with validated quantities ═══
  -- Delete existing lines and re-insert with validated quantities
  DELETE FROM bl_withdrawal_lines WHERE bl_withdrawal_document_id = v_bl_retrait.id;
  
  v_total_eur := 0;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_validated_lines)
  LOOP
    INSERT INTO bl_withdrawal_lines (
      bl_withdrawal_document_id,
      product_id,
      product_name_snapshot,
      quantity_canonical,
      canonical_unit_id,
      unit_price_snapshot,
      line_total_snapshot
    ) VALUES (
      v_bl_retrait.id,
      (v_line->>'supplier_product_id')::UUID,
      COALESCE(v_line->>'product_name_snapshot', ''),
      (v_line->>'quantity_canonical')::NUMERIC,
      (v_line->>'supplier_canonical_unit_id')::UUID,
      CASE WHEN v_line->>'unit_price' IS NOT NULL THEN (v_line->>'unit_price')::NUMERIC ELSE NULL END,
      CASE WHEN v_line->>'line_total' IS NOT NULL THEN (v_line->>'line_total')::NUMERIC ELSE NULL END
    );
    
    v_total_eur := v_total_eur + COALESCE((v_line->>'line_total')::NUMERIC, 0);
    v_line_count := v_line_count + 1;
  END LOOP;
  
  -- Update BL Retrait total
  UPDATE bl_withdrawal_documents 
  SET total_eur = ROUND(v_total_eur, 2)
  WHERE id = v_bl_retrait.id;

  -- ═══ 6. Create client RECEIPT stock document ═══
  -- Get header zone from first validated line's client product
  SELECT p.storage_zone_id INTO v_client_header_zone_id
  FROM jsonb_array_elements(p_validated_lines) AS jl
  JOIN products_v2 p ON p.id = (jl->>'client_product_id')::UUID
  WHERE p.storage_zone_id IS NOT NULL
  LIMIT 1;
  
  IF v_client_header_zone_id IS NULL THEN
    RAISE EXCEPTION 'CLIENT_NO_ZONE: Aucun produit client n''a de zone de stockage configurée';
  END IF;

  INSERT INTO stock_documents (
    establishment_id, organization_id, storage_zone_id,
    type, status, created_by, posted_by, posted_at
  ) VALUES (
    p_client_establishment_id, p_client_organization_id, v_client_header_zone_id,
    'RECEIPT', 'POSTED', p_client_user_id, p_client_user_id, now()
  ) RETURNING id INTO v_receipt_doc_id;

  -- ═══ 7. Insert client stock_document_lines + stock_events ═══
  -- Insert lines from validated data
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_validated_lines)
  LOOP
    INSERT INTO stock_document_lines (
      document_id, product_id,
      delta_quantity_canonical, canonical_unit_id,
      canonical_family, canonical_label, context_hash
    ) VALUES (
      v_receipt_doc_id,
      (v_line->>'client_product_id')::UUID,
      ABS((v_line->>'quantity_canonical')::NUMERIC),
      (v_line->>'client_canonical_unit_id')::UUID,
      v_line->>'client_canonical_family',
      v_line->>'client_canonical_label',
      v_line->>'client_context_hash'
    );
  END LOOP;

  -- Insert client stock events (RECEIPT, positive)
  INSERT INTO stock_events (
    establishment_id, organization_id, storage_zone_id, product_id,
    document_id, event_type, event_reason,
    delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label,
    context_hash, snapshot_version_id,
    override_flag, override_reason, posted_by
  )
  SELECT
    p_client_establishment_id,
    p_client_organization_id,
    p.storage_zone_id,
    (jl->>'client_product_id')::UUID,
    v_receipt_doc_id,
    'RECEIPT',
    'B2B_RECEPTION',
    ABS((jl->>'quantity_canonical')::NUMERIC),
    (jl->>'client_canonical_unit_id')::UUID,
    jl->>'client_canonical_family',
    jl->>'client_canonical_label',
    jl->>'client_context_hash',
    zss.snapshot_version_id,
    false,
    NULL,
    p_client_user_id
  FROM jsonb_array_elements(p_validated_lines) AS jl
  JOIN products_v2 p ON p.id = (jl->>'client_product_id')::UUID
  JOIN zone_stock_snapshots zss 
    ON zss.establishment_id = p_client_establishment_id 
    AND zss.storage_zone_id = p.storage_zone_id;

  GET DIAGNOSTICS v_receipt_event_count = ROW_COUNT;

  -- ═══ 8. Create BL Réception (bl_app_documents + bl_app_lines) ═══
  INSERT INTO bl_app_documents (
    establishment_id, stock_document_id,
    supplier_name_snapshot,
    bl_number, bl_date, status
  ) VALUES (
    p_client_establishment_id, v_receipt_doc_id,
    (SELECT name FROM establishments WHERE id = v_order.destination_establishment_id),
    'REC-CMD-' || LEFT(p_order_id::text, 6),
    (now() AT TIME ZONE 'Europe/Paris')::date::text,
    'FINAL'
  ) RETURNING id INTO v_bl_reception_id;

  -- Insert BL reception lines (CLIENT IDs only)
  INSERT INTO bl_app_lines (
    bl_app_document_id, establishment_id,
    product_id, product_name_snapshot,
    quantity_canonical, canonical_unit_id,
    unit_price, line_total
  )
  SELECT
    v_bl_reception_id,
    p_client_establishment_id,
    (jl->>'client_product_id')::UUID,
    COALESCE(jl->>'product_name_snapshot', ''),
    ABS((jl->>'quantity_canonical')::NUMERIC),
    (jl->>'client_canonical_unit_id')::UUID,
    CASE WHEN jl->>'unit_price' IS NOT NULL THEN (jl->>'unit_price')::NUMERIC ELSE NULL END,
    CASE WHEN jl->>'line_total' IS NOT NULL THEN (jl->>'line_total')::NUMERIC ELSE NULL END
  FROM jsonb_array_elements(p_validated_lines) AS jl;

  -- ═══ 9. Update order status ═══
  UPDATE product_orders SET
    status = 'received',
    bl_reception_document_id = v_bl_reception_id,
    updated_at = now()
  WHERE id = p_order_id;

  -- ═══ 10. Update quantity_received on order lines ═══
  UPDATE product_order_lines pol SET
    quantity_received = ABS((jl->>'quantity_canonical')::NUMERIC)
  FROM jsonb_array_elements(p_validated_lines) AS jl
  WHERE pol.order_id = p_order_id
    AND pol.product_id = (jl->>'client_product_id')::UUID;

  RETURN jsonb_build_object(
    'ok', true,
    'supplier_post', v_post_result,
    'receipt_document_id', v_receipt_doc_id,
    'bl_reception_id', v_bl_reception_id,
    'receipt_events_created', v_receipt_event_count,
    'lines_processed', v_line_count
  );

EXCEPTION WHEN OTHERS THEN
  -- Full rollback on any error
  RETURN jsonb_build_object(
    'ok', false, 
    'error', SQLERRM,
    'detail', SQLSTATE
  );
END;
$function$;
