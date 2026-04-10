
CREATE OR REPLACE FUNCTION public.platform_list_establishments(_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.name), '[]'::jsonb)
    FROM (
      SELECT
        e.id,
        e.name,
        e.status,
        e.created_at,
        e.establishment_type,
        (SELECT count(*) FROM user_establishments ue WHERE ue.establishment_id = e.id) AS user_count,
        ep.logo_url
      FROM establishments e
      LEFT JOIN establishment_profiles ep ON ep.establishment_id = e.id
      WHERE e.organization_id = _org_id
    ) t
  );
END;
$$;
