-- Add inventory_display_unit_id to products_v2 (lisibility preference, no impact on SSOT)
ALTER TABLE public.products_v2
ADD COLUMN inventory_display_unit_id UUID NULL
REFERENCES public.measurement_units(id) ON DELETE SET NULL;