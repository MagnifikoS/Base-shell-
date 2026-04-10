
CREATE OR REPLACE FUNCTION public.platform_delete_organization(_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_id uuid;
  v_org_name text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.is_platform_admin(v_caller_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_PLATFORM_ADMIN');
  END IF;

  SELECT name INTO v_org_name FROM organizations WHERE id = _org_id;
  IF v_org_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORG_NOT_FOUND');
  END IF;

  -- Delete cascading data tied to establishments of this org
  DELETE FROM platform_establishment_module_selections
  WHERE establishment_id IN (SELECT id FROM establishments WHERE organization_id = _org_id);

  DELETE FROM establishment_profiles
  WHERE establishment_id IN (SELECT id FROM establishments WHERE organization_id = _org_id);

  DELETE FROM user_establishments
  WHERE establishment_id IN (SELECT id FROM establishments WHERE organization_id = _org_id);

  DELETE FROM user_roles
  WHERE establishment_id IN (SELECT id FROM establishments WHERE organization_id = _org_id);

  DELETE FROM user_teams
  WHERE establishment_id IN (SELECT id FROM establishments WHERE organization_id = _org_id);

  DELETE FROM establishments WHERE organization_id = _org_id;

  DELETE FROM organizations WHERE id = _org_id;

  RETURN jsonb_build_object('ok', true, 'deleted_org', v_org_name);
END;
$$;
