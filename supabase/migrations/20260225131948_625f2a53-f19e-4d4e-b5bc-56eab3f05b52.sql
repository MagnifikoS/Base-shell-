-- Add product_name_snapshot to bl_app_lines for cross-org BL display
ALTER TABLE public.bl_app_lines 
ADD COLUMN IF NOT EXISTS product_name_snapshot text;

-- Backfill existing lines from products_v2 (admin context)
UPDATE public.bl_app_lines bal
SET product_name_snapshot = p.nom_produit
FROM public.products_v2 p
WHERE bal.product_id = p.id
  AND bal.product_name_snapshot IS NULL;