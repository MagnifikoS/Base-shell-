
-- Fix: audit_logs.target_id is UUID, not text — remove ::text casts

CREATE OR REPLACE FUNCTION public.start_impersonation(
  _target_user_id UUID,
  _target_establishment_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID;
  _is_pa BOOLEAN;
  _belongs BOOLEAN;
  _role_name TEXT;
  _session_id UUID;
BEGIN
  _caller := auth.uid();
  IF _caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT public.is_platform_admin(_caller) INTO _is_pa;
  IF NOT _is_pa THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_PLATFORM_ADMIN');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_establishments
    WHERE user_id = _target_user_id AND establishment_id = _target_establishment_id
  ) INTO _belongs;
  IF NOT _belongs THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_NOT_IN_ESTABLISHMENT');
  END IF;

  SELECT r.name INTO _role_name
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = _target_user_id
    AND ur.establishment_id = _target_establishment_id
  LIMIT 1;
  _role_name := COALESCE(_role_name, 'Inconnu');

  UPDATE public.platform_impersonations
  SET active = false, ended_at = now()
  WHERE platform_admin_id = _caller AND active = true;

  INSERT INTO public.platform_impersonations (
    platform_admin_id, target_user_id, target_establishment_id, target_role_name
  ) VALUES (
    _caller, _target_user_id, _target_establishment_id, _role_name
  ) RETURNING id INTO _session_id;

  -- Audit log: target_id is UUID, no ::text cast
  INSERT INTO public.audit_logs (
    organization_id, user_id, action, target_type, target_id, metadata
  )
  SELECT
    e.organization_id,
    _caller,
    'impersonation_start',
    'user',
    _target_user_id,
    jsonb_build_object(
      'session_id', _session_id,
      'target_establishment_id', _target_establishment_id,
      'target_role_name', _role_name
    )
  FROM public.establishments e
  WHERE e.id = _target_establishment_id;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', _session_id,
    'target_role_name', _role_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.stop_impersonation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID;
  _session RECORD;
BEGIN
  _caller := auth.uid();
  IF _caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT * INTO _session
  FROM public.platform_impersonations
  WHERE platform_admin_id = _caller AND active = true
  LIMIT 1;

  IF _session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SESSION');
  END IF;

  UPDATE public.platform_impersonations
  SET active = false, ended_at = now()
  WHERE id = _session.id;

  -- Audit log: target_id is UUID, no ::text cast
  INSERT INTO public.audit_logs (
    organization_id, user_id, action, target_type, target_id, metadata
  )
  SELECT
    e.organization_id,
    _caller,
    'impersonation_stop',
    'user',
    _session.target_user_id,
    jsonb_build_object(
      'session_id', _session.id,
      'duration_seconds', EXTRACT(EPOCH FROM (now() - _session.started_at))::int
    )
  FROM public.establishments e
  WHERE e.id = _session.target_establishment_id;

  RETURN jsonb_build_object('ok', true, 'session_id', _session.id);
END;
$$;
