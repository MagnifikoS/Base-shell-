-- Fix FK: add ON DELETE RESTRICT explicitly + index
ALTER TABLE public.supplier_product_aliases
  DROP CONSTRAINT IF EXISTS supplier_product_aliases_global_product_id_fkey;

ALTER TABLE public.supplier_product_aliases
  ADD CONSTRAINT supplier_product_aliases_global_product_id_fkey
  FOREIGN KEY (global_product_id)
  REFERENCES public.products_v2(id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_spa_global_product_id
  ON public.supplier_product_aliases(global_product_id);