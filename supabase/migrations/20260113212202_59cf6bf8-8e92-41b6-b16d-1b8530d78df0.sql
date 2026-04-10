BEGIN;

SET search_path = public;

-- ============================================================
-- ROLLBACK TOTAL PATCH A + PATCH C (SAFE - SANS CHANGER LE TYPE DE RETOUR)
-- ============================================================

-- 1) PATCH A — Supprimer le trigger d'immutabilité
DROP TRIGGER IF EXISTS prevent_profile_identity_change_trigger ON public.profiles;
DROP FUNCTION IF EXISTS public.prevent_profile_identity_change();

-- 2) Restaurer get_user_organization_id() (version originale sans check status)
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.organization_id
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1
$$;

-- 3) Restaurer get_user_establishment_ids() SANS check status
-- On garde SETOF uuid (type actuel) pour ne pas casser les policies
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

-- 4) Restaurer get_my_permissions() (VERSION ORIGINALE sans check is_active_user)
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
  _user_id := auth.uid();
  
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  _is_admin := public.is_admin(_user_id);

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

  SELECT COALESCE(array_agg(team_id), ARRAY[]::uuid[])
  INTO _team_ids
  FROM public.user_teams
  WHERE user_id = _user_id;

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
$$;

-- 4b) Restaurer planning_create_shift_atomic() (VERSION ORIGINALE sans check is_active_user)
CREATE OR REPLACE FUNCTION public.planning_create_shift_atomic(
  p_organization_id uuid, 
  p_establishment_id uuid, 
  p_user_id uuid, 
  p_shift_date date, 
  p_start_time time without time zone, 
  p_end_time time without time zone, 
  p_break_minutes integer, 
  p_net_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key BIGINT;
  v_existing_count INTEGER;
  v_new_shift planning_shifts%ROWTYPE;
BEGIN
  v_lock_key := ('x' || substr(
    md5(p_establishment_id::text || '|' || p_user_id::text || '|' || p_shift_date::text),
    1, 16
  ))::bit(64)::bigint;

  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT COUNT(*)
  INTO v_existing_count
  FROM planning_shifts
  WHERE establishment_id = p_establishment_id
    AND user_id = p_user_id
    AND shift_date = p_shift_date;

  IF v_existing_count >= 2 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Maximum 2 shifts per day',
      'status', 400
    );
  END IF;

  INSERT INTO planning_shifts (
    organization_id, establishment_id, user_id, shift_date,
    start_time, end_time, break_minutes, net_minutes
  )
  VALUES (
    p_organization_id, p_establishment_id, p_user_id, p_shift_date,
    p_start_time, p_end_time, p_break_minutes, p_net_minutes
  )
  RETURNING * INTO v_new_shift;

  RETURN jsonb_build_object(
    'ok', true,
    'shift', jsonb_build_object(
      'id', v_new_shift.id,
      'user_id', v_new_shift.user_id,
      'shift_date', v_new_shift.shift_date,
      'start_time', v_new_shift.start_time,
      'end_time', v_new_shift.end_time,
      'net_minutes', v_new_shift.net_minutes,
      'break_minutes', v_new_shift.break_minutes,
      'updated_at', v_new_shift.updated_at
    )
  );
END;
$$;

-- 5) Supprimer is_active_user (plus utilisée)
DROP FUNCTION IF EXISTS public.is_active_user(uuid);

COMMIT;