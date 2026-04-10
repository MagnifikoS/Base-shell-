
-- Add name snapshot columns to product_orders for cross-org display
ALTER TABLE public.product_orders
  ADD COLUMN IF NOT EXISTS source_name_snapshot text,
  ADD COLUMN IF NOT EXISTS destination_name_snapshot text;

-- Backfill existing orders with establishment names
UPDATE public.product_orders po
SET source_name_snapshot = e.name
FROM public.establishments e
WHERE e.id = po.source_establishment_id
  AND po.source_name_snapshot IS NULL;

UPDATE public.product_orders po
SET destination_name_snapshot = e.name
FROM public.establishments e
WHERE e.id = po.destination_establishment_id
  AND po.destination_name_snapshot IS NULL;
