-- RPC to resolve destination establishment by name (bypasses RLS)
CREATE OR REPLACE FUNCTION public.resolve_establishment_by_name(p_name text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.establishments WHERE name ILIKE '%' || p_name || '%' LIMIT 1;
$$;