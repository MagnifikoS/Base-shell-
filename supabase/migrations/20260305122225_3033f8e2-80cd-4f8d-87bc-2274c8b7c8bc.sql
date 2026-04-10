
-- Fix search_path on trigger function for linter compliance
CREATE OR REPLACE FUNCTION public.trg_clamp_shipped_quantity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.shipped_quantity IS NOT NULL AND NEW.shipped_quantity > NEW.canonical_quantity THEN
    NEW.shipped_quantity := NEW.canonical_quantity;
  END IF;
  RETURN NEW;
END;
$$;
