
-- Temporarily disable B2B guards to clean up order 47
ALTER TABLE product_order_lines DISABLE TRIGGER trg_b2b_line_deletion_guard;
ALTER TABLE product_orders DISABLE TRIGGER trg_b2b_status_transition_guard;

DELETE FROM product_order_lines WHERE order_id = '0b1b0af3-533d-4ac7-9e69-b27811d38b94';
DELETE FROM product_orders WHERE id = '0b1b0af3-533d-4ac7-9e69-b27811d38b94';

-- Re-enable triggers immediately
ALTER TABLE product_order_lines ENABLE TRIGGER trg_b2b_line_deletion_guard;
ALTER TABLE product_orders ENABLE TRIGGER trg_b2b_status_transition_guard;
