-- ═══════════════════════════════════════════════════════════════════════════
-- PRODUCT RECEPTION TOLERANCE — Add MIN + rename MAX
-- ═══════════════════════════════════════════════════════════════════════════
-- Replace single tolerance_max with min and max per product.

-- Add min column
ALTER TABLE public.products_v2 
  ADD COLUMN IF NOT EXISTS reception_tolerance_min NUMERIC;

COMMENT ON COLUMN public.products_v2.reception_tolerance_min IS 
  'Minimum reception quantity (canonical unit). NULL = no minimum. Warning if below.';

COMMENT ON COLUMN public.products_v2.reception_tolerance_max IS 
  'Maximum reception quantity (canonical unit). NULL = no maximum. Warning if above.';
