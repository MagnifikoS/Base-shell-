ALTER TABLE public.product_order_lines 
  ADD COLUMN IF NOT EXISTS resolved_supplier_product_id UUID DEFAULT NULL;

COMMENT ON COLUMN public.product_order_lines.resolved_supplier_product_id IS 
  'Supplier product ID resolved at ship time (cross-org only). Enables ID-only mapping without name fallback.';