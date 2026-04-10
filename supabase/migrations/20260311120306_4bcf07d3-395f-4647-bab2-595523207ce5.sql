
-- Add preparation fields to recipes
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS is_preparation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS yield_quantity numeric NULL,
  ADD COLUMN IF NOT EXISTS yield_unit_id uuid NULL REFERENCES public.measurement_units(id);

-- Add sub_recipe_id to recipe_lines (nullable, mutually exclusive with product_id)
ALTER TABLE public.recipe_lines
  ALTER COLUMN product_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS sub_recipe_id uuid NULL REFERENCES public.recipes(id) ON DELETE CASCADE;

-- Ensure a line has either product_id OR sub_recipe_id, never both, never neither
ALTER TABLE public.recipe_lines
  ADD CONSTRAINT chk_line_product_or_sub_recipe
    CHECK (
      (product_id IS NOT NULL AND sub_recipe_id IS NULL) OR
      (product_id IS NULL AND sub_recipe_id IS NOT NULL)
    );

-- Prevent preparations from containing other preparations (V1: 1-level only)
CREATE OR REPLACE FUNCTION public.trg_prevent_nested_preparations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sub_recipe_id IS NOT NULL THEN
    -- Check if the parent recipe is a preparation
    IF EXISTS (
      SELECT 1 FROM public.recipes WHERE id = NEW.recipe_id AND is_preparation = true
    ) THEN
      RAISE EXCEPTION 'Une préparation ne peut pas contenir une autre préparation (V1)';
    END IF;
    -- Check if the sub_recipe is actually a preparation
    IF NOT EXISTS (
      SELECT 1 FROM public.recipes WHERE id = NEW.sub_recipe_id AND is_preparation = true
    ) THEN
      RAISE EXCEPTION 'Seules les préparations peuvent être utilisées comme sous-recette';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recipe_lines_prevent_nested
  BEFORE INSERT OR UPDATE ON public.recipe_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_prevent_nested_preparations();

-- When is_preparation = true, portions should be NULL and selling_price should be NULL
-- We enforce this softly via a trigger
CREATE OR REPLACE FUNCTION public.trg_preparation_enforce_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_preparation = true THEN
    NEW.portions := NULL;
    NEW.selling_price := NULL;
    NEW.selling_price_mode := 'per_recipe';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recipes_preparation_enforce
  BEFORE INSERT OR UPDATE ON public.recipes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_preparation_enforce_fields();
