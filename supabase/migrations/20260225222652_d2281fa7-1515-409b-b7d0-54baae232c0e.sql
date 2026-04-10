
-- P0-2: Atomic B2B shipment cancellation RPC
CREATE OR REPLACE FUNCTION public.fn_cancel_b2b_shipment(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_bl RECORD;
  v_stock_doc RECORD;
  v_src_org UUID;
  v_dst_org UUID;
BEGIN
  -- 1. Lock and fetch order
  SELECT * INTO v_order
  FROM product_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Commande introuvable');
  END IF;

  -- 2. Verify status is cancellable
  IF v_order.status != 'awaiting_client_validation' THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('Annulation impossible : statut actuel = %s', v_order.status));
  END IF;

  -- 3. Verify cross-org
  SELECT organization_id INTO v_src_org FROM establishments WHERE id = v_order.source_establishment_id;
  SELECT organization_id INTO v_dst_org FROM establishments WHERE id = v_order.destination_establishment_id;
  IF v_src_org IS NULL OR v_dst_org IS NULL OR v_src_org = v_dst_org THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cette RPC est réservée aux commandes cross-org');
  END IF;

  -- 4. Verify BL exists
  IF v_order.bl_retrait_document_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Aucun BL Retrait associé');
  END IF;

  -- 5. Fetch BL + stock document
  SELECT * INTO v_bl
  FROM bl_withdrawal_documents
  WHERE id = v_order.bl_retrait_document_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BL Retrait introuvable');
  END IF;

  SELECT * INTO v_stock_doc
  FROM stock_documents
  WHERE id = v_bl.stock_document_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Document stock introuvable');
  END IF;

  -- 6. Verify DRAFT (no stock events exist)
  IF v_stock_doc.status != 'DRAFT' THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Annulation impossible : le document stock n''est plus en brouillon');
  END IF;

  -- 7. Delete BL lines
  DELETE FROM bl_withdrawal_lines WHERE bl_withdrawal_document_id = v_bl.id;

  -- 8. Delete stock document lines
  DELETE FROM stock_document_lines WHERE document_id = v_stock_doc.id;

  -- 9. Delete BL document
  DELETE FROM bl_withdrawal_documents WHERE id = v_bl.id;

  -- 10. Delete stock document (DRAFT, no events)
  DELETE FROM stock_documents WHERE id = v_stock_doc.id;

  -- 11. Revert order
  UPDATE product_orders
  SET status = 'prepared',
      bl_retrait_document_id = NULL,
      shipped_at = NULL
  WHERE id = p_order_id;

  -- 12. Clear resolved_supplier_product_id on order lines
  UPDATE product_order_lines
  SET resolved_supplier_product_id = NULL
  WHERE order_id = p_order_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- P2-1: Monitoring stuck B2B orders
CREATE OR REPLACE FUNCTION public.fn_stuck_b2b_orders_count()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count_48h INTEGER;
  v_count_72h INTEGER;
  v_oldest TIMESTAMPTZ;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE shipped_at < NOW() - INTERVAL '48 hours'),
    COUNT(*) FILTER (WHERE shipped_at < NOW() - INTERVAL '72 hours'),
    MIN(shipped_at)
  INTO v_count_48h, v_count_72h, v_oldest
  FROM product_orders
  WHERE status = 'awaiting_client_validation'
    AND shipped_at IS NOT NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'stuck_48h', COALESCE(v_count_48h, 0),
    'stuck_72h', COALESCE(v_count_72h, 0),
    'oldest_shipped_at', v_oldest
  );
END;
$$;
