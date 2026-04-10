-- PHASE 2 FIX: Allow product_id to be NULL so ON DELETE SET NULL works correctly
-- This is safe because:
-- 1. global_product_id + snapshots preserve historical data
-- 2. supplier_product_id_legacy keeps the reference for audit
-- 3. product_name_snapshot, product_code_snapshot etc. store the actual data

-- Make product_id nullable
ALTER TABLE public.invoice_line_items 
  ALTER COLUMN product_id DROP NOT NULL;

-- Add comment explaining the change
COMMENT ON COLUMN public.invoice_line_items.product_id IS 
  'Legacy FK to supplier_extracted_products. Nullable to allow product deletion. Historical data preserved in snapshots and global_product_id.';