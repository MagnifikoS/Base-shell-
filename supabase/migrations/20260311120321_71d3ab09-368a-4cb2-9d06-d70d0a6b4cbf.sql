
-- Fix search_path for the 2 new functions
CREATE OR REPLACE FUNCTION public.trg_prevent_nested_preparations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sub_recipe_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.recipes WHERE id = NEW.recipe_id AND is_preparation = true
    ) THEN
      RAISE EXCEPTION 'Une préparation ne peut pas contenir une autre préparation (V1)';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.recipes WHERE id = NEW.sub_recipe_id AND is_preparation = true
    ) THEN
      RAISE EXCEPTION 'Seules les préparations peuvent être utilisées comme sous-recette';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_preparation_enforce_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
