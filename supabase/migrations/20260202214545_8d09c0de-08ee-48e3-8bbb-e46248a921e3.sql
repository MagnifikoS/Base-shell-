-- ═══════════════════════════════════════════════════════════════════════════════
-- EXTRACTION EXCELLENCE V2: Add supplier_product_code for instant code matching
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add supplier_product_code column (nullable, specific to supplier)
ALTER TABLE public.supplier_extracted_products
ADD COLUMN IF NOT EXISTS supplier_product_code text;

-- Add comment for documentation
COMMENT ON COLUMN public.supplier_extracted_products.supplier_product_code IS 
'Supplier-specific product code from invoice. Priority source for matching.';

-- Create index for instant code-based matching (O(1) lookup)
CREATE INDEX IF NOT EXISTS idx_supplier_products_code_matching 
ON public.supplier_extracted_products (establishment_id, supplier_id, supplier_product_code)
WHERE supplier_product_code IS NOT NULL;

-- Create unique partial index to prevent duplicate codes per supplier
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_products_code_unique
ON public.supplier_extracted_products (establishment_id, supplier_id, supplier_product_code)
WHERE supplier_product_code IS NOT NULL AND status = 'validated';