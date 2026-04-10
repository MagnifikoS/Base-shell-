-- Add B2B billing columns to mutualisation groups
ALTER TABLE public.inventory_mutualisation_groups
  ADD COLUMN b2b_billing_unit_id uuid REFERENCES public.measurement_units(id),
  ADD COLUMN b2b_unit_price numeric,
  ADD COLUMN b2b_price_strategy text DEFAULT 'carrier';

-- Add comment for documentation
COMMENT ON COLUMN public.inventory_mutualisation_groups.b2b_billing_unit_id IS 'Resolved B2B billing unit (packaging unit if compatible, else commercial standard kg/L/pce)';
COMMENT ON COLUMN public.inventory_mutualisation_groups.b2b_unit_price IS 'Unified B2B selling price in b2b_billing_unit';
COMMENT ON COLUMN public.inventory_mutualisation_groups.b2b_price_strategy IS 'Price strategy: carrier, average, manual, supplier_a, supplier_b';