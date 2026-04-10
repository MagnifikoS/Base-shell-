
CREATE OR REPLACE FUNCTION public.platform_delete_organization(_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Temporarily disable the no-delete trigger on storage_zones
  -- Safe: this RPC is SECURITY DEFINER + platform admin only, and we're deleting the entire org
  ALTER TABLE public.storage_zones DISABLE TRIGGER trg_storage_zones_no_delete;

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

  -- Also clean up new supplier_clients tables if they exist
  DELETE FROM supplier_client_catalog_items
  WHERE supplier_establishment_id IN (SELECT id FROM establishments WHERE organization_id = _org_id)
     OR client_establishment_id IN (SELECT id FROM establishments WHERE organization_id = _org_id);

  DELETE FROM supplier_clients
  WHERE supplier_establishment_id IN (SELECT id FROM establishments WHERE organization_id = _org_id)
     OR client_establishment_id IN (SELECT id FROM establishments WHERE organization_id = _org_id);

  DELETE FROM establishments WHERE organization_id = _org_id;

  DELETE FROM organizations WHERE id = _org_id;

  -- Re-enable the trigger
  ALTER TABLE public.storage_zones ENABLE TRIGGER trg_storage_zones_no_delete;

  RETURN jsonb_build_object('ok', true, 'deleted_org', v_org_name);

EXCEPTION WHEN OTHERS THEN
  -- Always re-enable the trigger even if something fails
  ALTER TABLE public.storage_zones ENABLE TRIGGER trg_storage_zones_no_delete;
  RAISE;
END;
$function$;
