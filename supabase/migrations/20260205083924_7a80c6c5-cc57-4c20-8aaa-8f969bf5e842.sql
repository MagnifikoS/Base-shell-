-- Add price columns to products table (SSOT)
-- unit_price: prix unitaire en EUR (ex: 1.45 €/kg)
-- conditioning_price: prix par conditionnement en EUR (ex: 8.70 € le carton)

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10, 4) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS conditioning_price NUMERIC(10, 4) DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.products.unit_price IS 'Prix unitaire en EUR (ex: 1.45 €/kg)';
COMMENT ON COLUMN public.products.conditioning_price IS 'Prix par conditionnement en EUR (ex: 8.70 € le carton)';