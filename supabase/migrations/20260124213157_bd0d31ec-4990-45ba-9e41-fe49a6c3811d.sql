-- PHASE 2 / ÉTAPE 11: Admin override dans get_my_permissions_v2
-- Objectif: Aligner V2 shadow avec le comportement legacy V1 (admin = full/org sur tous modules)
-- Aucun changement sur get_my_permissions() (V1)

CREATE OR REPLACE FUNCTION public.get_my_permissions_v2(_establishment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid;
  _is_admin boolean;
  _permissions jsonb;
  _team_ids uuid[];
  _establishment_ids uuid[];
BEGIN
  _user_id := auth.uid();
  
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  _is_admin := public.is_admin(_user_id);

  -- Get permissions from roles that apply to this establishment (scoped OR global legacy)
  WITH user_perms AS (
    SELECT 
      rp.module_key,
      rp.access_level,
      rp.scope
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN public.role_permissions rp ON rp.role_id = r.id
    WHERE ur.user_id = _user_id
      AND (ur.establishment_id = _establishment_id OR ur.establishment_id IS NULL)
  ),
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
            WHEN 'caisse_day' THEN 3
            WHEN 'caisse_month' THEN 4
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

  -- ═══════════════════════════════════════════════════════════════════════════
  -- ADMIN OVERRIDE (Phase 2 / Étape 11)
  -- Pour les admins, forcer access_level='full' et scope='org' sur tous modules
  -- Alignement avec le comportement legacy V1 côté frontend
  -- ═══════════════════════════════════════════════════════════════════════════
  IF _is_admin THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'module_key', p->>'module_key',
          'access_level', 'full',
          'scope', 'org'
        )
      ),
      '[]'::jsonb
    )
    INTO _permissions
    FROM jsonb_array_elements(_permissions) AS p;
  END IF;

  -- Get teams that apply to this establishment (scoped OR global legacy)
  SELECT COALESCE(array_agg(team_id), ARRAY[]::uuid[])
  INTO _team_ids
  FROM public.user_teams
  WHERE user_id = _user_id
    AND (establishment_id = _establishment_id OR establishment_id IS NULL);

  -- Keep establishment_ids same as v1 (all user's establishments from user_establishments)
  SELECT COALESCE(array_agg(establishment_id), ARRAY[]::uuid[])
  INTO _establishment_ids
  FROM public.user_establishments
  WHERE user_id = _user_id;

  RETURN jsonb_build_object(
    'is_admin', _is_admin,
    'permissions', _permissions,
    'team_ids', to_jsonb(_team_ids),
    'establishment_ids', to_jsonb(_establishment_ids)
  );
END;
$function$;