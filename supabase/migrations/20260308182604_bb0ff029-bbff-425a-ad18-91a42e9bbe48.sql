ALTER TABLE public.recipes ADD COLUMN selling_price numeric NULL;

CREATE OR REPLACE FUNCTION public.trg_validate_selling_price()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.selling_price IS NOT NULL AND NEW.selling_price < 0 THEN
    RAISE EXCEPTION 'selling_price must be >= 0';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_selling_price
  BEFORE INSERT OR UPDATE ON public.recipes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_validate_selling_price();