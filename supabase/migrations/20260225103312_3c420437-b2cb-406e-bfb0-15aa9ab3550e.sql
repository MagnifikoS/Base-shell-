
-- ═══════════════════════════════════════════════════════════════════
-- DATA CLEANUP: Delete all test orders for Labaja/Magnifiko/Piccolo
-- Stock will be corrected by a future inventory — no VOID needed.
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_order_ids uuid[];
  v_bl_retrait_ids uuid[];
  v_bl_reception_ids uuid[];
  v_bl_retrait_stock_doc_ids uuid[];
  v_bl_reception_stock_doc_ids uuid[];
BEGIN
  -- 1. Collect all order IDs
  SELECT array_agg(po.id) INTO v_order_ids
  FROM product_orders po
  WHERE (
    po.source_establishment_id IN (
      'e9c3dccf-bee3-46c0-b068-52e05c18d883',  -- Magnifiko
      'c0129f18-dfe7-4cc5-bc4e-d00e9e1d977e',  -- Piccolo Magnifiko
      '9ac57795-0724-42a1-a555-f4b3bcbb2f22'   -- Labaja
    )
    AND po.destination_establishment_id = '9ac57795-0724-42a1-a555-f4b3bcbb2f22'
  )
  OR (
    po.source_establishment_id = '9ac57795-0724-42a1-a555-f4b3bcbb2f22'
    AND po.destination_establishment_id IN (
      'e9c3dccf-bee3-46c0-b068-52e05c18d883',
      'c0129f18-dfe7-4cc5-bc4e-d00e9e1d977e'
    )
  );

  IF v_order_ids IS NULL THEN
    RAISE NOTICE 'No orders found, nothing to delete.';
    RETURN;
  END IF;

  RAISE NOTICE 'Found % orders to delete', array_length(v_order_ids, 1);

  -- 2. Collect BL Retrait IDs
  SELECT array_agg(bl_retrait_document_id) INTO v_bl_retrait_ids
  FROM product_orders
  WHERE id = ANY(v_order_ids) AND bl_retrait_document_id IS NOT NULL;

  -- 3. Collect BL Réception IDs
  SELECT array_agg(bl_reception_document_id) INTO v_bl_reception_ids
  FROM product_orders
  WHERE id = ANY(v_order_ids) AND bl_reception_document_id IS NOT NULL;

  -- 4. Get stock_document_ids from BL Retrait
  IF v_bl_retrait_ids IS NOT NULL THEN
    SELECT array_agg(stock_document_id) INTO v_bl_retrait_stock_doc_ids
    FROM bl_withdrawal_documents WHERE id = ANY(v_bl_retrait_ids);
  END IF;

  -- 5. Get stock_document_ids from BL Réception
  IF v_bl_reception_ids IS NOT NULL THEN
    SELECT array_agg(stock_document_id) INTO v_bl_reception_stock_doc_ids
    FROM bl_app_documents WHERE id = ANY(v_bl_reception_ids);
  END IF;

  -- ═══ DELETE in correct FK order ═══

  -- 6. Delete notification events referencing these orders
  DELETE FROM notification_events
  WHERE payload->>'order_id' = ANY(SELECT unnest(v_order_ids)::text);

  -- 7. Delete BL Retrait lines + documents
  IF v_bl_retrait_ids IS NOT NULL THEN
    DELETE FROM bl_withdrawal_lines WHERE bl_withdrawal_document_id = ANY(v_bl_retrait_ids);
    DELETE FROM bl_withdrawal_documents WHERE id = ANY(v_bl_retrait_ids);
  END IF;

  -- 8. Delete BL Réception lines + files + documents
  IF v_bl_reception_ids IS NOT NULL THEN
    DELETE FROM bl_app_lines WHERE bl_app_document_id = ANY(v_bl_reception_ids);
    DELETE FROM bl_app_files WHERE bl_app_document_id = ANY(v_bl_reception_ids);
    DELETE FROM bl_app_documents WHERE id = ANY(v_bl_reception_ids);
  END IF;

  -- 9. Delete order lines
  DELETE FROM product_order_lines WHERE order_id = ANY(v_order_ids);

  -- 10. Delete orders
  DELETE FROM product_orders WHERE id = ANY(v_order_ids);

  -- 11. Cleanup orphaned stock documents (optional, won't break anything if left)
  -- Stock events are append-only with triggers preventing DELETE, so we skip them.
  -- An inventory will reset the snapshots.

  RAISE NOTICE 'Cleanup complete. Deleted % orders, % BL retrait, % BL réception.',
    array_length(v_order_ids, 1),
    COALESCE(array_length(v_bl_retrait_ids, 1), 0),
    COALESCE(array_length(v_bl_reception_ids, 1), 0);
END;
$$;
