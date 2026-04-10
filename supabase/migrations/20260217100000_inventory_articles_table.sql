-- ═══════════════════════════════════════════════════════════════════════════
-- INVENTORY ARTICLES — Grouping entity for stock management
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Create inventory_articles table
CREATE TABLE IF NOT EXISTS public.inventory_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  storage_zone_id UUID REFERENCES public.storage_zones(id),
  canonical_unit_id UUID NOT NULL REFERENCES public.measurement_units(id),
  canonical_family TEXT NOT NULL,
  min_stock_quantity_canonical NUMERIC,
  min_stock_unit_id UUID REFERENCES public.measurement_units(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- 2. RLS
ALTER TABLE public.inventory_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view inventory articles in their establishments" ON public.inventory_articles;
CREATE POLICY "Users can view inventory articles in their establishments"
  ON public.inventory_articles FOR SELECT TO authenticated
  USING (public.has_module_access('inventaire', 'read', establishment_id));

DROP POLICY IF EXISTS "Users can insert inventory articles in their establishments" ON public.inventory_articles;
CREATE POLICY "Users can insert inventory articles in their establishments"
  ON public.inventory_articles FOR INSERT TO authenticated
  WITH CHECK (public.has_module_access('inventaire', 'write', establishment_id));

DROP POLICY IF EXISTS "Users can update inventory articles in their establishments" ON public.inventory_articles;
CREATE POLICY "Users can update inventory articles in their establishments"
  ON public.inventory_articles FOR UPDATE TO authenticated
  USING (public.has_module_access('inventaire', 'write', establishment_id));

DROP POLICY IF EXISTS "Users can delete inventory articles in their establishments" ON public.inventory_articles;
CREATE POLICY "Users can delete inventory articles in their establishments"
  ON public.inventory_articles FOR DELETE TO authenticated
  USING (public.has_module_access('inventaire', 'full', establishment_id));

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_inv_articles_establishment ON public.inventory_articles(establishment_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inv_articles_zone ON public.inventory_articles(storage_zone_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inv_articles_name_norm ON public.inventory_articles(establishment_id, name_normalized);

-- 4. Updated_at trigger
DROP TRIGGER IF EXISTS update_inventory_articles_updated_at ON public.inventory_articles;
CREATE TRIGGER update_inventory_articles_updated_at
  BEFORE UPDATE ON public.inventory_articles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Add inventory_article_id FK to products_v2
ALTER TABLE public.products_v2 ADD COLUMN IF NOT EXISTS inventory_article_id UUID REFERENCES public.inventory_articles(id);
CREATE INDEX IF NOT EXISTS idx_products_v2_inv_article ON public.products_v2(inventory_article_id) WHERE archived_at IS NULL;

-- 6. Auto-migration: 1:1 products → articles (skip if articles already exist)
INSERT INTO public.inventory_articles (establishment_id, name, name_normalized, storage_zone_id, canonical_unit_id, canonical_family, min_stock_quantity_canonical, min_stock_unit_id)
SELECT
  p.establishment_id,
  p.nom_produit,
  lower(trim(p.nom_produit)),
  p.storage_zone_id,
  p.stock_handling_unit_id,
  COALESCE(u.family, 'unit'),
  p.min_stock_quantity_canonical,
  p.min_stock_unit_id
FROM public.products_v2 p
LEFT JOIN public.measurement_units u ON u.id = p.stock_handling_unit_id
WHERE p.archived_at IS NULL
  AND p.stock_handling_unit_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.inventory_articles);

-- 7. Link products back to their newly-created articles
UPDATE public.products_v2 p
SET inventory_article_id = ia.id
FROM public.inventory_articles ia
WHERE ia.establishment_id = p.establishment_id
  AND ia.name = p.nom_produit
  AND ia.canonical_unit_id = p.stock_handling_unit_id
  AND p.archived_at IS NULL
  AND p.inventory_article_id IS NULL
  AND p.stock_handling_unit_id IS NOT NULL;
