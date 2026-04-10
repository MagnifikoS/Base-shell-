
-- ============================================================
-- PURGE: 5 test products for fo@test.fr organization
-- Products: TEST 1, TEST 2, TEST 3, PRODUIT X, PRODUIT Y
-- Establishment: 78eb1ffe-b468-496a-89e3-a4558e78533c
-- ============================================================

DO $$
DECLARE
  target_pids uuid[] := ARRAY[
    '4f09fd17-2aea-4d14-b012-14aace75df49',
    '6aacc5f8-d772-4de8-a87a-f209f62a5e53',
    '6d1e34bb-2fa6-4e8b-a77f-ec8da06c03a0',
    'bd4032d5-4932-4c86-a6bf-cf5f33cec499',
    '7ed92409-fc90-48f0-bd81-fb8a87423efc'
  ];
  doc_ids uuid[];
BEGIN
  -- Collect stock document IDs before deleting events
  SELECT array_agg(DISTINCT document_id) INTO doc_ids
  FROM stock_events
  WHERE product_id = ANY(target_pids);

  -- 1. Disable ledger protection trigger
  ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_delete;

  -- 2. Delete stock_events for these products
  DELETE FROM stock_events WHERE product_id = ANY(target_pids);

  -- 3. Re-enable ledger protection trigger
  ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_delete;

  -- 4. Delete orphaned stock_documents (only those with no remaining events)
  IF doc_ids IS NOT NULL THEN
    DELETE FROM stock_documents 
    WHERE id = ANY(doc_ids)
      AND NOT EXISTS (
        SELECT 1 FROM stock_events se WHERE se.document_id = stock_documents.id
      );
  END IF;

  -- 5. Delete inventory_discrepancies
  DELETE FROM inventory_discrepancies WHERE product_id = ANY(target_pids);

  -- 6. Delete inventory_lines
  DELETE FROM inventory_lines WHERE product_id = ANY(target_pids);

  -- 7. Delete the products themselves
  DELETE FROM products_v2 WHERE id = ANY(target_pids);
END $$;
