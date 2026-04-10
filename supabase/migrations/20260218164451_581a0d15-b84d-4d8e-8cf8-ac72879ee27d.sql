
ALTER TABLE public.products_v2
  ADD COLUMN IF NOT EXISTS reception_tolerance_min numeric NULL,
  ADD COLUMN IF NOT EXISTS reception_tolerance_max numeric NULL,
  ADD COLUMN IF NOT EXISTS reception_tolerance_unit_id uuid NULL;
