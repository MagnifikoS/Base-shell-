ALTER TABLE public.recipes 
ADD COLUMN selling_price_mode text NOT NULL DEFAULT 'per_recipe';

-- Validation trigger for selling_price_mode
CREATE OR REPLACE FUNCTION public.fn_validate_selling_price_mode()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.selling_price_mode NOT IN ('per_recipe', 'per_portion') THEN
    RAISE EXCEPTION 'selling_price_mode must be per_recipe or per_portion';
  END IF;
  -- If no portions, force per_recipe
  IF (NEW.portions IS NULL OR NEW.portions < 1) AND NEW.selling_price_mode = 'per_portion' THEN
    NEW.selling_price_mode := 'per_recipe';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_selling_price_mode
BEFORE INSERT OR UPDATE ON public.recipes
FOR EACH ROW
EXECUTE FUNCTION public.fn_validate_selling_price_mode();