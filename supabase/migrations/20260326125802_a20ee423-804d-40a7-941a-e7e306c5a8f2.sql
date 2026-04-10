
-- 1. Rename default_unit_id → preferred_unit_id (intent = suggestion, not truth)
ALTER TABLE public.product_input_config
  RENAME COLUMN reception_default_unit_id TO reception_preferred_unit_id;

ALTER TABLE public.product_input_config
  RENAME COLUMN internal_default_unit_id TO internal_preferred_unit_id;

-- 2. Drop level_* boolean flags (motor decides levels, not config)
ALTER TABLE public.product_input_config
  DROP COLUMN reception_level_1,
  DROP COLUMN reception_level_2,
  DROP COLUMN reception_final_unit,
  DROP COLUMN internal_level_1,
  DROP COLUMN internal_level_2,
  DROP COLUMN internal_final_unit;

-- 3. Add architecture comment
COMMENT ON COLUMN public.product_input_config.reception_preferred_unit_id IS 
  'SUGGESTION only — must be validated against resolveProductUnitContext at runtime. Never use as source of truth.';
COMMENT ON COLUMN public.product_input_config.internal_preferred_unit_id IS 
  'SUGGESTION only — must be validated against resolveProductUnitContext at runtime. Never use as source of truth.';
