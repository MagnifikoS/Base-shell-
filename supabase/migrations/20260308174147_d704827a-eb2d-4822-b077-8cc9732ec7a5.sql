
-- Add portions column to recipes
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS portions integer DEFAULT NULL;

-- Validation trigger: portions must be >= 1 if set
CREATE OR REPLACE FUNCTION public.trg_validate_recipe_portions()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.portions IS NOT NULL AND NEW.portions < 1 THEN
    RAISE EXCEPTION 'portions must be >= 1 or NULL';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_recipe_portions ON public.recipes;
CREATE TRIGGER validate_recipe_portions
  BEFORE INSERT OR UPDATE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_recipe_portions();

-- Update atomic RPC to accept _portions parameter
CREATE OR REPLACE FUNCTION public.fn_create_recipe_with_lines(
  _establishment_id UUID,
  _name TEXT,
  _recipe_type_id UUID,
  _created_by UUID,
  _lines JSONB DEFAULT '[]'::JSONB,
  _portions INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _recipe_id UUID;
  _line JSONB;
  _i INT := 0;
BEGIN
  INSERT INTO public.recipes (establishment_id, name, recipe_type_id, created_by, portions)
  VALUES (_establishment_id, trim(_name), _recipe_type_id, _created_by, _portions)
  RETURNING id INTO _recipe_id;

  FOR _line IN SELECT * FROM jsonb_array_elements(_lines)
  LOOP
    INSERT INTO public.recipe_lines (recipe_id, product_id, quantity, unit_id, display_order)
    VALUES (
      _recipe_id,
      (_line->>'product_id')::UUID,
      (_line->>'quantity')::NUMERIC,
      (_line->>'unit_id')::UUID,
      _i
    );
    _i := _i + 1;
  END LOOP;

  RETURN _recipe_id;
END;
$$;
