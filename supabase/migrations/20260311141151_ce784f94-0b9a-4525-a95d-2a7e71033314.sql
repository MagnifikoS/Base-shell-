
CREATE OR REPLACE FUNCTION public.fn_create_recipe_full(
  _establishment_id UUID,
  _name TEXT,
  _recipe_type_id UUID,
  _created_by UUID,
  _is_preparation BOOLEAN DEFAULT FALSE,
  _portions INTEGER DEFAULT NULL,
  _yield_quantity NUMERIC DEFAULT NULL,
  _yield_unit_id UUID DEFAULT NULL,
  _selling_price NUMERIC DEFAULT NULL,
  _selling_price_mode TEXT DEFAULT 'per_recipe',
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
  _display_order INT := 0;
BEGIN
  -- 1. Create recipe with all fields atomically
  INSERT INTO public.recipes (
    establishment_id, name, recipe_type_id, created_by,
    is_preparation, portions, yield_quantity, yield_unit_id,
    selling_price, selling_price_mode
  ) VALUES (
    _establishment_id,
    UPPER(TRIM(_name)),
    _recipe_type_id,
    _created_by,
    _is_preparation,
    _portions,
    _yield_quantity,
    _yield_unit_id,
    _selling_price,
    COALESCE(_selling_price_mode, 'per_recipe')
  )
  RETURNING id INTO _recipe_id;

  -- 2. Insert all lines (product + sub-recipe) in one pass
  FOR _line IN SELECT * FROM jsonb_array_elements(_lines)
  LOOP
    INSERT INTO public.recipe_lines (
      recipe_id,
      product_id,
      sub_recipe_id,
      quantity,
      unit_id,
      display_order
    ) VALUES (
      _recipe_id,
      CASE WHEN _line->>'sub_recipe_id' IS NOT NULL AND _line->>'sub_recipe_id' != '' 
        THEN NULL 
        ELSE (_line->>'product_id')::UUID 
      END,
      CASE WHEN _line->>'sub_recipe_id' IS NOT NULL AND _line->>'sub_recipe_id' != '' 
        THEN (_line->>'sub_recipe_id')::UUID 
        ELSE NULL 
      END,
      (_line->>'quantity')::NUMERIC,
      (_line->>'unit_id')::UUID,
      _display_order
    );
    _display_order := _display_order + 1;
  END LOOP;

  RETURN _recipe_id;
END;
$$;
