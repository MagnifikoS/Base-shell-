
-- Add source_snapshot column to store supplier data at import time
-- This allows detecting SUPPLIER-side changes (not client-side edits)
ALTER TABLE public.products_v2 
ADD COLUMN IF NOT EXISTS source_snapshot jsonb DEFAULT NULL;

-- Backfill existing products that have source_product_id:
-- Take current values as the "last known supplier state"
UPDATE public.products_v2
SET source_snapshot = jsonb_build_object(
  'nom_produit', nom_produit,
  'name_normalized', name_normalized,
  'final_unit_price', final_unit_price,
  'conditionnement_resume', conditionnement_resume,
  'supplier_billing_unit', supplier_billing_unit,
  'final_unit', final_unit
)
WHERE source_product_id IS NOT NULL
  AND source_snapshot IS NULL;

COMMENT ON COLUMN public.products_v2.source_snapshot IS 'Snapshot of supplier product data at import/last-sync time. Used for detecting supplier-side changes only.';
