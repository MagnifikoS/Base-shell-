
-- Add source_product_id: traces which supplier product this local copy was imported from.
-- Nullable (existing products keep NULL = no impact). Only set during cross-org catalog import.
ALTER TABLE public.products_v2
  ADD COLUMN IF NOT EXISTS source_product_id UUID DEFAULT NULL;

-- Index for fast lookup: "has this supplier product already been imported?"
CREATE INDEX IF NOT EXISTS idx_products_v2_source_product_id
  ON public.products_v2 (source_product_id)
  WHERE source_product_id IS NOT NULL;

COMMENT ON COLUMN public.products_v2.source_product_id IS
  'UUID of the original product in the supplier establishment. Set at import time, never modified. Used for cross-org sync detection and "already added" matching.';
