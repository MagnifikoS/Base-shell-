-- ═══════════════════════════════════════════════════════════════════════════
-- PRODUCT RECEPTION TOLERANCE — Maximum quantity tolerance per product
-- ═══════════════════════════════════════════════════════════════════════════
-- §7 from RECEPTION spec: per-product max quantity for reception.
-- If received quantity exceeds tolerance, a warning popup is shown.
-- No complex detection — just a simple threshold check.

ALTER TABLE public.products_v2 
  ADD COLUMN IF NOT EXISTS reception_tolerance_max NUMERIC;

COMMENT ON COLUMN public.products_v2.reception_tolerance_max IS 
  'Maximum reception quantity (canonical unit). NULL = no limit. Warning popup shown if exceeded.';
