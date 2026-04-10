
-- Add product name snapshot to avoid joining products_v2 in the orderPrep module
ALTER TABLE public.to_order_lines ADD COLUMN product_name text NOT NULL DEFAULT '';
