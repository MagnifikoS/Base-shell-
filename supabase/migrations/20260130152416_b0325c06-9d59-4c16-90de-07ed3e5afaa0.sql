-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: Add 'self' scope support to has_module_access
-- Fix: Employees with scope='self' were getting false (403) even with valid permissions
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.has_module_access(_module_key text, _min_level access_level, _establishment_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  max_rank int := 0;
  min_rank int := 0;
  has_perm boolean := false;
  perm_scope public.permission_scope;
BEGIN
  -- Admin shortcut
  IF public.is_admin(auth.uid()) THEN
    RETURN true;
  END IF;

  -- map min level to rank
  min_rank := CASE _min_level
    WHEN 'none' THEN 0
    WHEN 'read' THEN 1
    WHEN 'write' THEN 2
    WHEN 'full' THEN 3
    ELSE 0
  END;

  /*
    Compute the highest access level for this module across all roles of the user.
    Also keep the most permissive scope among matching rows.
  */
  SELECT
    COALESCE(MAX(CASE rp.access_level
      WHEN 'none' THEN 0
      WHEN 'read' THEN 1
      WHEN 'write' THEN 2
      WHEN 'full' THEN 3
      ELSE 0
    END), 0) AS access_rank,
    (ARRAY_AGG(rp.scope ORDER BY CASE rp.scope
      WHEN 'org' THEN 4
      WHEN 'establishment' THEN 3
      WHEN 'team' THEN 2
      WHEN 'self' THEN 1
      ELSE 0
    END DESC))[1] AS best_scope
  INTO max_rank, perm_scope
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  JOIN public.role_permissions rp ON rp.role_id = r.id
  WHERE ur.user_id = auth.uid()
    AND rp.module_key = _module_key
    AND (r.organization_id IS NULL OR r.organization_id = public.get_user_organization_id());

  has_perm := (max_rank >= min_rank);
  IF NOT has_perm THEN
    RETURN false;
  END IF;

  -- Scope enforcement
  IF perm_scope = 'org' THEN
    RETURN true;
  ELSIF perm_scope = 'establishment' THEN
    RETURN _establishment_id IN (SELECT public.get_user_establishment_ids());
  ELSIF perm_scope = 'team' THEN
    -- Team scope: user can access data within their establishments
    -- Note: actual team filtering must be done in the calling code
    RETURN _establishment_id IN (SELECT public.get_user_establishment_ids());
  ELSIF perm_scope = 'self' THEN
    -- Self scope: user can only access their OWN data within their establishments
    -- WARNING: Edge Functions MUST verify that target user matches auth.uid() 
    -- when performing operations on user-specific data (e.g., declare_absence checks user_id = caller)
    RETURN _establishment_id IN (SELECT public.get_user_establishment_ids());
  ELSE
    -- Caisse-specific scopes (caisse_day, caisse_month) or unknown scopes
    -- Default to establishment check for safety
    RETURN _establishment_id IN (SELECT public.get_user_establishment_ids());
  END IF;
END;
$function$;