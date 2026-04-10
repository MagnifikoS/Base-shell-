
ALTER TABLE product_order_lines DISABLE TRIGGER trg_b2b_mapping_guard;

UPDATE product_order_lines 
SET resolved_supplier_product_id = 'a04a5278-7b1a-44a1-8b91-6f62ae19b871'
WHERE id = '313c195c-afae-4ede-9f89-6c812fc87a37';

ALTER TABLE product_order_lines ENABLE TRIGGER trg_b2b_mapping_guard;
