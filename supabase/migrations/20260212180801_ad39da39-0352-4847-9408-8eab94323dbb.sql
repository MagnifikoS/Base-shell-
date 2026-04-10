
-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 4: Add min_stock columns to products_v2
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.products_v2
  ADD COLUMN min_stock_quantity_canonical numeric NULL,
  ADD COLUMN min_stock_unit_id uuid NULL REFERENCES public.measurement_units(id),
  ADD COLUMN min_stock_updated_at timestamp with time zone NULL,
  ADD COLUMN min_stock_updated_by uuid NULL;

-- Index for alert queries (find products below min stock)
CREATE INDEX idx_products_v2_min_stock ON public.products_v2 (establishment_id, min_stock_quantity_canonical)
  WHERE min_stock_quantity_canonical IS NOT NULL AND archived_at IS NULL;

COMMENT ON COLUMN public.products_v2.min_stock_quantity_canonical IS 'Stock minimum en unité canonique (SSOT). NULL = pas de seuil défini.';
COMMENT ON COLUMN public.products_v2.min_stock_unit_id IS 'UUID de l''unité canonique au moment du save (doit matcher la famille canonical du produit).';
