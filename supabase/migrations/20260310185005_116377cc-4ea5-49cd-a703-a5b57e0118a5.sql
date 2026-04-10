
CREATE OR REPLACE FUNCTION public.resolve_commande_actors(p_ids jsonb)
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
  SELECT array_agg(val::uuid) INTO v_commande_uuids
  FROM jsonb_array_elements_text(p_ids) AS val;

  IF v_commande_uuids IS NULL THEN RETURN; END IF;

  SELECT array_agg(eid) INTO v_user_est_ids
  FROM get_user_establishment_ids() AS eid;

  IF v_user_est_ids IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT DISTINCT p.user_id,
    CASE
      WHEN p.second_first_name IS NOT NULL AND p.full_name IS NOT NULL
        THEN p.second_first_name || ' ' || p.full_name
      WHEN p.full_name IS NOT NULL THEN p.full_name
      WHEN p.second_first_name IS NOT NULL THEN p.second_first_name
      ELSE 'Utilisateur'
    END AS display_name
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

NOTIFY pgrst, 'reload schema';
