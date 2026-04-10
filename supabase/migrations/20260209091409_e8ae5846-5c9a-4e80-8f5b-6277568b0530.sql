
-- PHASE 1 - ÉTAPE 6: Passer supplier_id en NOT NULL
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE products_v2 
ALTER COLUMN supplier_id SET NOT NULL;
