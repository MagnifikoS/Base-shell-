-- Add FK constraint on supplier_product_aliases.global_product_id → products_v2(id)
-- SmartMatch will use this column as the SSOT link to products_v2
ALTER TABLE public.supplier_product_aliases
  ADD CONSTRAINT supplier_product_aliases_global_product_id_fkey
  FOREIGN KEY (global_product_id) REFERENCES public.products_v2(id);