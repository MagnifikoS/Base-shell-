-- Add unique partial index on supplier_product_code (SSOT for product matching)
-- This ensures O(1) lookup when matching by supplier-specific product code

-- First, check if any duplicates exist and handle them (keeping most recent)
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY establishment_id, supplier_id, supplier_product_code 
           ORDER BY updated_at DESC
         ) as rn
  FROM public.supplier_extracted_products
  WHERE supplier_product_code IS NOT NULL 
    AND supplier_product_code != ''
)
UPDATE public.supplier_extracted_products
SET supplier_product_code = NULL
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Create unique partial index (only where supplier_product_code is not null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_products_code_unique 
ON public.supplier_extracted_products (establishment_id, supplier_id, supplier_product_code)
WHERE supplier_product_code IS NOT NULL AND supplier_product_code != '';