
-- PHASE 1 - ÉTAPES 2-7: Migration supplier_id
-- ════════════════════════════════════════════════════════════════════

-- ÉTAPE 2: Ajouter la colonne supplier_id (nullable temporairement)
ALTER TABLE products_v2 
ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES invoice_suppliers(id);

-- ÉTAPE 7: Index de performance (créé maintenant car pas de données liées)
CREATE INDEX IF NOT EXISTS idx_products_v2_supplier_id 
ON products_v2(supplier_id);
