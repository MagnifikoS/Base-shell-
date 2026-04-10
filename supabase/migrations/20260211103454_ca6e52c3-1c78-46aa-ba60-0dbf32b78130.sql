
-- Add kitchen_unit_id to products_v2
ALTER TABLE public.products_v2
ADD COLUMN kitchen_unit_id uuid NULL;

-- FK to measurement_units
ALTER TABLE public.products_v2
ADD CONSTRAINT products_v2_kitchen_unit_id_fkey
FOREIGN KEY (kitchen_unit_id) REFERENCES public.measurement_units(id);
