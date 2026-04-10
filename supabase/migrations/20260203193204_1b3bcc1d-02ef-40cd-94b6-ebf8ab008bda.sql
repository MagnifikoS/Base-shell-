-- ============================================
-- Product Categories Table
-- SSOT for category catalog per establishment
-- ============================================

CREATE TABLE IF NOT EXISTS public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  name_normalized text NOT NULL,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one category name per establishment
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_categories_unique 
ON public.product_categories(establishment_id, name_normalized) 
WHERE is_archived = false;

-- Performance index
CREATE INDEX IF NOT EXISTS idx_product_categories_establishment 
ON public.product_categories(establishment_id, is_archived);

-- Enable RLS
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

-- RLS Policies (using same pattern as products table with 'factures' module since produits re-uses it)
CREATE POLICY "product_categories_select" 
ON public.product_categories 
FOR SELECT 
USING (has_module_access('factures'::text, 'read'::access_level, establishment_id));

CREATE POLICY "product_categories_insert" 
ON public.product_categories 
FOR INSERT 
WITH CHECK (has_module_access('factures'::text, 'write'::access_level, establishment_id));

CREATE POLICY "product_categories_update" 
ON public.product_categories 
FOR UPDATE 
USING (has_module_access('factures'::text, 'write'::access_level, establishment_id));

CREATE POLICY "product_categories_delete" 
ON public.product_categories 
FOR DELETE 
USING (has_module_access('factures'::text, 'write'::access_level, establishment_id));

-- Updated_at trigger
CREATE TRIGGER update_product_categories_updated_at
BEFORE UPDATE ON public.product_categories
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();