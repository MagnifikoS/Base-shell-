-- Force PostgREST cache bypass by recreating function with clean signature
-- Drop all overloads
DROP FUNCTION IF EXISTS public.resolve_commande_user_names(uuid[]);
DROP FUNCTION IF EXISTS public.resolve_commande_user_names(text[]);

-- Recreate with text[] (PostgREST sends JSON arrays as text)
CREATE FUNCTION public.resolve_commande_user_names(p_commande_ids text[])
RETURNS TABLE(user_id uuid, display_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_est_ids uuid[];
  v_commande_uuids uuid[];
BEGIN
  v_commande_uuids := p_commande_ids::uuid[];

  SELECT array_agg(eid) INTO v_user_est_ids
  FROM get_user_establishment_ids() AS eid;

  IF v_user_est_ids IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT p.user_id,
    COALESCE(p.second_first_name, split_part(p.full_name, ' ', 1), p.full_name) AS display_name
  FROM profiles p
  WHERE p.status = 'active'
    AND p.user_id IN (
      SELECT unnest(ARRAY[
        c.created_by, c.opened_by, c.shipped_by, c.received_by
      ])
      FROM commandes c
      WHERE c.id = ANY(v_commande_uuids)
        AND (
          c.client_establishment_id = ANY(v_user_est_ids)
          OR c.supplier_establishment_id = ANY(v_user_est_ids)
        )
    );
END;
$$;

-- Force schema reload
NOTIFY pgrst, 'reload schema';