-- ============================================
-- RPC: get_my_permissions()
-- Returns user permissions, team_ids, and establishment_ids in a single call
-- Security: Only returns data for auth.uid(), no parameters accepted
-- ============================================

CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid;
  _is_admin boolean;
  _permissions jsonb;
  _team_ids uuid[];
  _establishment_ids uuid[];
BEGIN
  -- Get authenticated user
  _user_id := auth.uid();
  
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if admin
  _is_admin := public.is_admin(_user_id);

  -- Get all permissions from user's roles (max access_level and max scope per module)
  WITH user_perms AS (
    SELECT 
      rp.module_key,
      rp.access_level,
      rp.scope
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN public.role_permissions rp ON rp.role_id = r.id
    WHERE ur.user_id = _user_id
  ),
  -- Aggregate: for each module, take max access_level and max scope
  aggregated AS (
    SELECT 
      module_key,
      (ARRAY['none', 'read', 'write', 'full'])[
        MAX(
          CASE access_level
            WHEN 'none' THEN 1
            WHEN 'read' THEN 2
            WHEN 'write' THEN 3
            WHEN 'full' THEN 4
          END
        )
      ]::public.access_level AS access_level,
      (ARRAY['self', 'team', 'establishment', 'org'])[
        MAX(
          CASE scope
            WHEN 'self' THEN 1
            WHEN 'team' THEN 2
            WHEN 'establishment' THEN 3
            WHEN 'org' THEN 4
            WHEN 'caisse_day' THEN 3  -- treat as establishment
            WHEN 'caisse_month' THEN 4 -- treat as org
          END
        )
      ]::public.permission_scope AS scope
    FROM user_perms
    GROUP BY module_key
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'module_key', module_key,
        'access_level', access_level,
        'scope', scope
      )
    ),
    '[]'::jsonb
  )
  INTO _permissions
  FROM aggregated;

  -- Get user's team IDs
  SELECT COALESCE(array_agg(team_id), ARRAY[]::uuid[])
  INTO _team_ids
  FROM public.user_teams
  WHERE user_id = _user_id;

  -- Get user's establishment IDs
  SELECT COALESCE(array_agg(establishment_id), ARRAY[]::uuid[])
  INTO _establishment_ids
  FROM public.user_establishments
  WHERE user_id = _user_id;

  -- Return combined result
  RETURN jsonb_build_object(
    'is_admin', _is_admin,
    'permissions', _permissions,
    'team_ids', to_jsonb(_team_ids),
    'establishment_ids', to_jsonb(_establishment_ids)
  );
END;
$$;

-- Grant execute to authenticated users only
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_permissions() FROM anon, public;