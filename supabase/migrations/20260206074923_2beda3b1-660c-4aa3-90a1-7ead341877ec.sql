-- ============================================
-- MODULE PRODUITS V1 — TABLE SSOT
-- Drop existing products table and recreate with V1 schema
-- ============================================

-- 1. Drop dependent foreign keys first
ALTER TABLE public.invoice_line_items DROP CONSTRAINT IF EXISTS invoice_line_items_global_product_id_fkey;

-- 2. Drop existing products table
DROP TABLE IF EXISTS public.products CASCADE;

-- 3. Create new products table with V1 schema
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  code_produit TEXT,
  nom_produit TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  prix_unitaire NUMERIC,
  fournisseurs TEXT,
  conditionnement TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Unique constraint: one product name per establishment
CREATE UNIQUE INDEX products_establishment_name_normalized_unique 
ON public.products (establishment_id, name_normalized) 
WHERE archived_at IS NULL;

-- 5. Index for faster lookups
CREATE INDEX products_establishment_id_idx ON public.products(establishment_id);
CREATE INDEX products_archived_at_idx ON public.products(archived_at);

-- 6. Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies using module_key 'produits'
-- First, add module 'produits' if not exists
INSERT INTO public.modules (key, name, display_order)
VALUES ('produits', 'Produits', 30)
ON CONFLICT (key) DO NOTHING;

-- SELECT policy
CREATE POLICY "products_select" ON public.products
  FOR SELECT
  USING (has_module_access('produits'::text, 'read'::access_level, establishment_id));

-- INSERT policy
CREATE POLICY "products_insert" ON public.products
  FOR INSERT
  WITH CHECK (has_module_access('produits'::text, 'write'::access_level, establishment_id));

-- UPDATE policy
CREATE POLICY "products_update" ON public.products
  FOR UPDATE
  USING (has_module_access('produits'::text, 'write'::access_level, establishment_id));

-- DELETE policy (even though we use soft delete, keep for admin cleanup)
CREATE POLICY "products_delete" ON public.products
  FOR DELETE
  USING (has_module_access('produits'::text, 'full'::access_level, establishment_id));

-- 8. Trigger for updated_at
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();