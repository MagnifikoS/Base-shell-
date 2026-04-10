-- ═══════════════════════════════════════════════════════════════════════════
-- Étape 1 : Refactorisation fn_cancel_b2b_shipment
-- AVANT : DELETE de documents/lignes + exige DRAFT
-- APRÈS : VOID du stock_document POSTED + conservation intégrale des données
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_cancel_b2b_shipment(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_bl RECORD;
  v_stock_doc RECORD;
  v_src_org UUID;
  v_dst_org UUID;
  v_void_result JSONB;
  v_invoices_cancelled INT := 0;
BEGIN
  -- 1. Lock and fetch order
  SELECT * INTO v_order
  FROM product_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Commande introuvable');
  END IF;

  -- 2. Verify status is cancellable (only before client reception)
  IF v_order.status NOT IN ('awaiting_client_validation', 'shipped') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('Annulation impossible : statut actuel = %s (seuls "awaiting_client_validation" et "shipped" sont annulables)', v_order.status));
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

  -- 6. Handle based on stock document status
  IF v_stock_doc.status = 'POSTED' THEN
    -- ══ VOID PATH: Document already posted → create inverse events ══
    v_void_result := fn_void_stock_document(
      p_document_id := v_stock_doc.id,
      p_voided_by := COALESCE(auth.uid(), v_order.created_by),
      p_void_reason := format('Annulation expédition B2B - commande %s', p_order_id)
    );
    IF NOT (v_void_result->>'ok')::boolean THEN
      RETURN jsonb_build_object('ok', false, 'error', 
        format('Échec VOID du document stock : %s', v_void_result->>'error'),
        'void_details', v_void_result);
    END IF;
  ELSIF v_stock_doc.status = 'DRAFT' THEN
    -- ══ DRAFT PATH (legacy): Safe to delete since no events exist ══
    DELETE FROM stock_document_lines WHERE document_id = v_stock_doc.id;
    DELETE FROM stock_documents WHERE id = v_stock_doc.id;
  ELSIF v_stock_doc.status = 'VOID' THEN
    -- Already voided (idempotency)
    v_void_result := jsonb_build_object('ok', true, 'already_voided', true);
  ELSE
    RETURN jsonb_build_object('ok', false, 'error',
      format('Statut document stock inattendu : %s', v_stock_doc.status));
  END IF;

  -- 7. Mark associated B2B invoices as cancelled (do NOT delete them)
  UPDATE invoices
  SET b2b_status = 'cancelled',
      updated_at = now()
  WHERE b2b_order_id = p_order_id
    AND b2b_status != 'cancelled';
  GET DIAGNOSTICS v_invoices_cancelled = ROW_COUNT;

  -- 8. Revert order status to "prepared" (transition guard allows this)
  -- Keep bl_retrait_document_id for traceability (BL is historical proof)
  UPDATE product_orders
  SET status = 'prepared',
      shipped_at = NULL
  WHERE id = p_order_id;

  -- 9. Clear resolved_supplier_product_id for re-shipment
  UPDATE product_order_lines
  SET resolved_supplier_product_id = NULL
  WHERE order_id = p_order_id;

  RETURN jsonb_build_object(
    'ok', true,
    'void_result', COALESCE(v_void_result, jsonb_build_object('path', 'draft_cleanup')),
    'invoices_cancelled', v_invoices_cancelled,
    'order_status', 'prepared'
  );
END;
$function$;