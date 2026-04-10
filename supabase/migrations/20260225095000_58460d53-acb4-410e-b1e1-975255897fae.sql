CREATE OR REPLACE FUNCTION public.platform_delete_organization(_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
  v_org_name text;
  v_trigger_disabled boolean := false;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.is_platform_admin(v_caller_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_PLATFORM_ADMIN');
  END IF;

  SELECT name INTO v_org_name FROM organizations WHERE id = _org_id;
  IF v_org_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORG_NOT_FOUND');
  END IF;

  -- Protection explicite de l'organisation AMIR
  IF upper(trim(v_org_name)) = 'AMIR' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORG_PROTECTED');
  END IF;

  -- Autoriser la suppression complète des zones uniquement pendant cette opération
  ALTER TABLE public.storage_zones DISABLE TRIGGER trg_storage_zones_no_delete;
  v_trigger_disabled := true;

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

  -- Tables optionnelles (peuvent ne pas exister selon l'état des migrations)
  IF to_regclass('public.supplier_client_catalog_items') IS NOT NULL THEN
    EXECUTE $sql$
      DELETE FROM public.supplier_client_catalog_items
      WHERE supplier_establishment_id IN (SELECT id FROM public.establishments WHERE organization_id = $1)
         OR client_establishment_id IN (SELECT id FROM public.establishments WHERE organization_id = $1)
    $sql$
    USING _org_id;
  END IF;

  IF to_regclass('public.supplier_clients') IS NOT NULL THEN
    EXECUTE $sql$
      DELETE FROM public.supplier_clients
      WHERE supplier_establishment_id IN (SELECT id FROM public.establishments WHERE organization_id = $1)
         OR client_establishment_id IN (SELECT id FROM public.establishments WHERE organization_id = $1)
    $sql$
    USING _org_id;
  END IF;

  DELETE FROM establishments WHERE organization_id = _org_id;
  DELETE FROM organizations WHERE id = _org_id;

  ALTER TABLE public.storage_zones ENABLE TRIGGER trg_storage_zones_no_delete;

  RETURN jsonb_build_object('ok', true, 'deleted_org', v_org_name);

EXCEPTION WHEN OTHERS THEN
  -- Toujours réactiver le trigger en cas d'erreur
  IF v_trigger_disabled THEN
    ALTER TABLE public.storage_zones ENABLE TRIGGER trg_storage_zones_no_delete;
  END IF;
  RAISE;
END;
$function$;