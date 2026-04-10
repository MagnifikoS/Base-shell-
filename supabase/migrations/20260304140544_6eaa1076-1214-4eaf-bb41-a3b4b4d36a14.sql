
CREATE OR REPLACE FUNCTION public.resolve_user_display_names(p_user_ids uuid[])
RETURNS TABLE(user_id uuid, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.user_id,
    COALESCE(p.second_first_name, split_part(p.full_name, ' ', 1), p.full_name) AS display_name
  FROM profiles p
  WHERE p.user_id = ANY(p_user_ids)
    AND p.status = 'active';
$$;
