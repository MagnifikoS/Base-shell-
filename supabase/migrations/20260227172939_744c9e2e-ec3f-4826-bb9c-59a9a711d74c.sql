
-- Disable guards for cleanup of orders 27 & 36
ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_delete;
ALTER TABLE product_order_lines DISABLE TRIGGER trg_b2b_line_deletion_guard;
ALTER TABLE product_order_lines DISABLE TRIGGER trg_b2b_mapping_guard;
ALTER TABLE product_orders DISABLE TRIGGER trg_b2b_close_guard;
ALTER TABLE product_orders DISABLE TRIGGER trg_b2b_status_transition_guard;

-- Stock events
DELETE FROM stock_events 
WHERE document_id IN ('875570e6-05bd-41e1-88bc-c220e3b0a0ba','d170847d-cb8f-43d0-bb30-15e2ff12bb0c');

-- BL withdrawal lines
DELETE FROM bl_withdrawal_lines 
WHERE bl_withdrawal_document_id IN ('1f4c3e70-31c5-48f7-8c32-9a5c7ba9a521','e91c5332-e5a4-47c2-95df-1c5a09bca44e');

-- BL withdrawal documents
DELETE FROM bl_withdrawal_documents 
WHERE id IN ('1f4c3e70-31c5-48f7-8c32-9a5c7ba9a521','e91c5332-e5a4-47c2-95df-1c5a09bca44e');

-- Stock document lines
DELETE FROM stock_document_lines 
WHERE document_id IN ('875570e6-05bd-41e1-88bc-c220e3b0a0ba','d170847d-cb8f-43d0-bb30-15e2ff12bb0c');

-- Stock documents
DELETE FROM stock_documents 
WHERE id IN ('875570e6-05bd-41e1-88bc-c220e3b0a0ba','d170847d-cb8f-43d0-bb30-15e2ff12bb0c');

-- Product order lines
DELETE FROM product_order_lines 
WHERE order_id IN ('71da8cad-5025-440d-b67d-c1d3d16ff777','f0000002-ae50-b2b0-0002-000000000002');

-- Product orders
DELETE FROM product_orders 
WHERE id IN ('71da8cad-5025-440d-b67d-c1d3d16ff777','f0000002-ae50-b2b0-0002-000000000002');

-- Re-enable all guards
ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_delete;
ALTER TABLE product_order_lines ENABLE TRIGGER trg_b2b_line_deletion_guard;
ALTER TABLE product_order_lines ENABLE TRIGGER trg_b2b_mapping_guard;
ALTER TABLE product_orders ENABLE TRIGGER trg_b2b_close_guard;
ALTER TABLE product_orders ENABLE TRIGGER trg_b2b_status_transition_guard;
