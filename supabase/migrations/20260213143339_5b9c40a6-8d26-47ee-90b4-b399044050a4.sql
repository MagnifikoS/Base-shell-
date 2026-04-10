-- Deduplicate existing bl_app_lines: keep only one line per (document, product),
-- merging quantities by summing them.
WITH ranked AS (
  SELECT id,
         bl_app_document_id,
         product_id,
         ROW_NUMBER() OVER (PARTITION BY bl_app_document_id, product_id ORDER BY created_at ASC) AS rn,
         SUM(quantity_canonical) OVER (PARTITION BY bl_app_document_id, product_id) AS total_qty
  FROM public.bl_app_lines
),
-- Update the first row of each group with the summed quantity
updated AS (
  UPDATE public.bl_app_lines
  SET quantity_canonical = ranked.total_qty
  FROM ranked
  WHERE bl_app_lines.id = ranked.id AND ranked.rn = 1
)
-- Delete all duplicates (rn > 1)
DELETE FROM public.bl_app_lines
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Add unique constraint to prevent future duplicates
ALTER TABLE public.bl_app_lines
  ADD CONSTRAINT bl_app_lines_unique_doc_product UNIQUE (bl_app_document_id, product_id);