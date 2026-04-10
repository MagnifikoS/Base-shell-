-- Fix D: Add unit_of_sale and category columns to supplier_extracted_products
-- These are needed to persist all product metadata from the extraction

-- Add unit_of_sale column if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'supplier_extracted_products' 
    AND column_name = 'unit_of_sale'
  ) THEN
    ALTER TABLE public.supplier_extracted_products ADD COLUMN unit_of_sale text;
  END IF;
END $$;

-- Add category column if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'supplier_extracted_products' 
    AND column_name = 'category'
  ) THEN
    ALTER TABLE public.supplier_extracted_products ADD COLUMN category text;
  END IF;
END $$;

-- Add index on normalized product name for duplicate detection
CREATE INDEX IF NOT EXISTS idx_supplier_extracted_products_name_normalized 
ON public.supplier_extracted_products (supplier_id, establishment_id, lower(product_name));