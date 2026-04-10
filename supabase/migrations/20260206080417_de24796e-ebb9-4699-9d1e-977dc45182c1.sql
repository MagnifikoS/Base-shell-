-- Add code_barres column to products table
ALTER TABLE public.products
ADD COLUMN code_barres TEXT DEFAULT NULL;

-- Add index for barcode lookups
CREATE INDEX idx_products_code_barres ON public.products (code_barres) WHERE code_barres IS NOT NULL;