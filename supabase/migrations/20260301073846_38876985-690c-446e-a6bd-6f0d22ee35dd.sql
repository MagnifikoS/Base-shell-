
-- ═══════════════════════════════════════════════════════════════════════════
-- fn_delete_order_line: Atomic line deletion with BL void if needed
-- Idempotent: if line doesn't exist, returns success
-- Concurrency: locks order row FOR UPDATE
-- Non-destructive: uses VOID for stock documents, never cross-order impact
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_delete_order_line(
  p_line_id UUID,
  p_order_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_line RECORD;
  v_bl_retrait_id UUID;
  v_stock_doc_id UUID;
  v_remaining INT;
  v_void_result JSONB;
BEGIN
  -- 1. Lock the order
  SELECT * INTO v_order
  FROM product_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  -- Cannot delete from received/closed orders
  IF v_order.status IN ('received', 'closed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_FINALIZED', 'current_status', v_order.status);
  END IF;

  -- 2. Find the line (idempotent: if not found, return success)
  SELECT * INTO v_line
  FROM product_order_lines
  WHERE id = p_line_id AND order_id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'detail', 'LINE_ALREADY_DELETED');
  END IF;

  -- 3. If BL Retrait exists, VOID the linked stock document
  v_bl_retrait_id := v_order.bl_retrait_document_id;

  IF v_bl_retrait_id IS NOT NULL THEN
    SELECT stock_document_id INTO v_stock_doc_id
    FROM bl_withdrawal_documents
    WHERE id = v_bl_retrait_id;

    IF v_stock_doc_id IS NOT NULL THEN
      -- Use fn_void_stock_document for proper ledger reversal
      v_void_result := fn_void_stock_document(
        p_document_id := v_stock_doc_id,
        p_reason := 'Suppression ligne commande: ' || v_line.product_name_snapshot,
        p_user_id := p_user_id
      );

      IF v_void_result IS NOT NULL AND NOT COALESCE((v_void_result->>'ok')::boolean, false) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'VOID_FAILED', 'detail', v_void_result->>'error');
      END IF;
    END IF;

    -- Remove BL Retrait (metadata only — stock already voided)
    DELETE FROM bl_withdrawal_lines WHERE bl_withdrawal_document_id = v_bl_retrait_id;
    DELETE FROM bl_withdrawal_documents WHERE id = v_bl_retrait_id;

    -- Reset order shipment state
    UPDATE product_orders
    SET bl_retrait_document_id = NULL,
        status = 'prepared',
        shipped_at = NULL
    WHERE id = p_order_id;
  END IF;

  -- 4. Delete the line
  DELETE FROM product_order_lines WHERE id = p_line_id;

  -- 5. Check if this was the last line
  SELECT COUNT(*) INTO v_remaining
  FROM product_order_lines
  WHERE order_id = p_order_id;

  IF v_remaining = 0 THEN
    -- Auto-close only if safe (no active BLs)
    IF v_order.bl_retrait_document_id IS NULL AND v_order.bl_reception_document_id IS NULL
       AND v_order.status NOT IN ('shipped', 'received', 'closed') THEN
      UPDATE product_orders SET status = 'closed' WHERE id = p_order_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'remaining_lines', v_remaining);
END;
$$;
