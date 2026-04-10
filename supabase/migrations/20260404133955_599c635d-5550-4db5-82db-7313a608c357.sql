-- Step 1: Add purchase_* columns (additive, nullable initially for safe migration)
ALTER TABLE public.product_input_config
  ADD COLUMN purchase_mode text NOT NULL DEFAULT 'integer',
  ADD COLUMN purchase_preferred_unit_id uuid REFERENCES public.measurement_units(id),
  ADD COLUMN purchase_unit_chain jsonb;

-- Step 2: Backfill from existing reception_* values
-- This is safe because currently no product has multi_level reception config
-- and reception_* was shared between purchase and B2B sale contexts.
UPDATE public.product_input_config
SET
  purchase_mode = reception_mode,
  purchase_preferred_unit_id = reception_preferred_unit_id,
  purchase_unit_chain = reception_unit_chain;

-- Step 3: Add RLS policy for the new columns (existing policies already cover SELECT/INSERT/UPDATE on the table, no new policy needed since columns inherit table-level RLS)