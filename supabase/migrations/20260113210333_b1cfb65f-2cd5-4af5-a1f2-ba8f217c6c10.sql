-- ═══════════════════════════════════════════════════════════════════════════
-- PATCH C — Barrière "user actif" (is_active_user + modification fonctions racines)
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Créer la fonction is_active_user (retourne FALSE si inactif, pas d'exception)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_active_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = _user_id 
      AND status = 'active'
  )
$$;

-- Révoquer l'exécution publique directe (sera appelée via RLS/autres fonctions)
REVOKE EXECUTE ON FUNCTION public.is_active_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Modifier get_user_organization_id() : retourne NULL si user inactif
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id 
  FROM public.profiles 
  WHERE user_id = auth.uid() 
    AND status = 'active'
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Modifier get_user_establishment_ids() : retourne vide si user inactif
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_establishment_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ue.establishment_id 
  FROM public.user_establishments ue
  JOIN public.profiles p ON p.user_id = ue.user_id
  WHERE ue.user_id = auth.uid()
    AND p.status = 'active'
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) Modifier get_my_permissions() : check actif au début + retour vide si inactif
-- ───────────────────────────────────────────────────────────────────────────
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

  -- ═══════════════════════════════════════════════════════════════════════
  -- PATCH C: Vérifier que le user est actif, sinon retourner permissions vides
  -- ═══════════════════════════════════════════════════════════════════════
  IF NOT public.is_active_user(_user_id) THEN
    RETURN jsonb_build_object(
      'is_admin', false,
      'permissions', '[]'::jsonb,
      'team_ids', '[]'::jsonb,
      'establishment_ids', '[]'::jsonb
    );
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

-- ───────────────────────────────────────────────────────────────────────────
-- 5) Modifier planning_create_shift_atomic() : check actif + erreur explicite
-- ───────────────────────────────────────────────────────────────────────────
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
  v_caller_id uuid;
BEGIN
  -- ═══════════════════════════════════════════════════════════════════════
  -- PATCH C: Vérifier que le caller est actif
  -- ═══════════════════════════════════════════════════════════════════════
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.is_active_user(v_caller_id) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'User not active or not authenticated',
      'status', 403
    );
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 1: Generate a collision-resistant 64-bit lock key
  -- ══════════════════════════════════════════════════════════════════════
  v_lock_key := ('x' || substr(
    md5(p_establishment_id::text || '|' || p_user_id::text || '|' || p_shift_date::text),
    1, 16
  ))::bit(64)::bigint;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 2: Acquire advisory lock (transaction-scoped)
  -- ══════════════════════════════════════════════════════════════════════
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 3: Count existing shifts for this tuple (AFTER lock acquired)
  -- ══════════════════════════════════════════════════════════════════════
  SELECT COUNT(*)
  INTO v_existing_count
  FROM planning_shifts
  WHERE establishment_id = p_establishment_id
    AND user_id = p_user_id
    AND shift_date = p_shift_date;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 4: If already 2 or more, reject with structured error
  -- ══════════════════════════════════════════════════════════════════════
  IF v_existing_count >= 2 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Maximum 2 shifts per day',
      'status', 400
    );
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 5: Insert new shift (still under lock)
  -- ══════════════════════════════════════════════════════════════════════
  INSERT INTO planning_shifts (
    organization_id,
    establishment_id,
    user_id,
    shift_date,
    start_time,
    end_time,
    break_minutes,
    net_minutes
  )
  VALUES (
    p_organization_id,
    p_establishment_id,
    p_user_id,
    p_shift_date,
    p_start_time,
    p_end_time,
    p_break_minutes,
    p_net_minutes
  )
  RETURNING * INTO v_new_shift;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 6: Return success with the new shift data
  -- ══════════════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK SQL (à conserver pour référence):
-- 
-- -- Restaurer get_user_organization_id sans check status
-- CREATE OR REPLACE FUNCTION public.get_user_organization_id()
-- RETURNS uuid
-- LANGUAGE sql
-- STABLE
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
--   SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
-- $$;
--
-- -- Restaurer get_user_establishment_ids sans check status
-- CREATE OR REPLACE FUNCTION public.get_user_establishment_ids()
-- RETURNS SETOF uuid
-- LANGUAGE sql
-- STABLE
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
--   SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid()
-- $$;
--
-- -- Supprimer is_active_user
-- DROP FUNCTION IF EXISTS public.is_active_user(uuid);
--
-- -- Restaurer get_my_permissions (version originale sans check status)
-- -- [Coller la version originale ici]
-- ═══════════════════════════════════════════════════════════════════════════