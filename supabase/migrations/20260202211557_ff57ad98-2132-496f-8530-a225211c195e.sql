-- Add product_code column to supplier_extracted_products for stable matching
-- This is supplier-specific (not global), extracted from invoices

ALTER TABLE public.supplier_extracted_products 
ADD COLUMN IF NOT EXISTS product_code TEXT;

-- Add index for fast lookups by (supplier_id, establishment_id, product_code)
CREATE INDEX IF NOT EXISTS idx_sep_supplier_product_code 
ON public.supplier_extracted_products(supplier_id, establishment_id, product_code) 
WHERE product_code IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.supplier_extracted_products.product_code IS 
'Supplier-specific product code (ex: "Code", "Réf", "Codice"). Priority key for matching. Null if not present in invoice.';