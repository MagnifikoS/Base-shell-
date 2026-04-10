
-- Drop the old unique constraint on (establishment_id, name_normalized)
-- which prevents importing same-named products from different suppliers
DROP INDEX IF EXISTS idx_products_v2_establishment_name_normalized;

-- Create new unique index scoped by supplier: allows same product name
-- from different suppliers within the same establishment
CREATE UNIQUE INDEX idx_products_v2_establishment_supplier_name 
ON public.products_v2 (establishment_id, supplier_id, name_normalized) 
WHERE (archived_at IS NULL);
