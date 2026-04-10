-- Allow non-admin users with badgeuse permission (scope establishment/org) to read presence data

-- 1) Helper: compare access levels and check scope
CREATE OR REPLACE FUNCTION public.has_module_access(
  _module_key text,
  _min_level public.access_level,
  _establishment_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      WHEN 'org' THEN 3
      WHEN 'establishment' THEN 2
      WHEN 'team' THEN 1
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
  ELSE
    -- other scopes not supported for establishment-wide reads
    RETURN false;
  END IF;
END;
$$;

-- 2) Policies for presence reads

-- planning_shifts: allow reading shifts in assigned establishments when user has badgeuse read+
DROP POLICY IF EXISTS "Users can view shifts for assigned establishments (badgeuse)" ON public.planning_shifts;
CREATE POLICY "Users can view shifts for assigned establishments (badgeuse)"
ON public.planning_shifts
FOR SELECT
TO authenticated
USING (
  organization_id = public.get_user_organization_id()
  AND public.has_module_access('badgeuse', 'read', establishment_id)
);

-- badge_events: allow reading badge events in assigned establishments when user has badgeuse read+
DROP POLICY IF EXISTS "Users can view badge events for assigned establishments (badgeuse)" ON public.badge_events;
CREATE POLICY "Users can view badge events for assigned establishments (badgeuse)"
ON public.badge_events
FOR SELECT
TO authenticated
USING (
  organization_id = public.get_user_organization_id()
  AND public.has_module_access('badgeuse', 'read', establishment_id)
);
