-- ═══════════════════════════════════════════════════════════════════════════
-- PRODUCT RECEPTION TOLERANCE — Add unit for min/max values
-- ═══════════════════════════════════════════════════════════════════════════
-- The tolerance min/max are expressed in this unit (pièce, boîte, carton, etc.)
-- When comparing, received quantity is converted to this unit first.

ALTER TABLE public.products_v2 
  ADD COLUMN IF NOT EXISTS reception_tolerance_unit_id UUID REFERENCES public.measurement_units(id);

COMMENT ON COLUMN public.products_v2.reception_tolerance_unit_id IS 
  'Unit for tolerance min/max values. Must be one of the product conditioning units. NULL = canonical unit.';
