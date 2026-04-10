-- Add billing metadata columns for faithful wizard Step 3 reopening
-- These are UX-only fields: the price SSOT remains final_unit_price
ALTER TABLE public.products_v2
  ADD COLUMN IF NOT EXISTS supplier_billing_quantity numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS supplier_billing_line_total numeric DEFAULT NULL;

-- Add a comment to clarify intent
COMMENT ON COLUMN public.products_v2.supplier_billing_quantity IS 'UX metadata: raw billed quantity entered in wizard Step 3. Not a price SSOT.';
COMMENT ON COLUMN public.products_v2.supplier_billing_line_total IS 'UX metadata: raw line total entered in wizard Step 3. Not a price SSOT.';