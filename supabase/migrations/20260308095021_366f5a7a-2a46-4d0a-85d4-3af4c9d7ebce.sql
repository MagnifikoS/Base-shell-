
-- ═══════════════════════════════════════════════════════════════
-- MODULE RECETTES — Corrections P0/P1
-- 1. Drop FK created_by -> auth.users (forbidden by project rules)
-- 2. Create atomic RPC fn_create_recipe_with_lines
-- ═══════════════════════════════════════════════════════════════

-- 1. Drop the FK constraint on recipes.created_by -> auth.users
ALTER TABLE public.recipes DROP CONSTRAINT IF EXISTS recipes_created_by_fkey;

-- 2. Atomic RPC: create recipe + lines in a single transaction
CREATE OR REPLACE FUNCTION public.fn_create_recipe_with_lines(
  _establishment_id UUID,
  _name TEXT,
  _recipe_type_id UUID,
  _created_by UUID,
  _lines JSONB DEFAULT '[]'::JSONB
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
  -- Insert recipe
  INSERT INTO public.recipes (establishment_id, name, recipe_type_id, created_by)
  VALUES (_establishment_id, trim(_name), _recipe_type_id, _created_by)
  RETURNING id INTO _recipe_id;

  -- Insert lines
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
