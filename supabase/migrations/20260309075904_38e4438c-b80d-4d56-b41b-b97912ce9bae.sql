
-- Fix search_path for b2b trigger function
CREATE OR REPLACE FUNCTION public.fn_b2b_recipe_listings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
