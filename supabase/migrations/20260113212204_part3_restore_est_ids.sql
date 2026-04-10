-- Part 3: Restore get_user_establishment_ids
CREATE OR REPLACE FUNCTION public.get_user_establishment_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ue.establishment_id 
  FROM public.user_establishments ue
  WHERE ue.user_id = auth.uid()
$$;
