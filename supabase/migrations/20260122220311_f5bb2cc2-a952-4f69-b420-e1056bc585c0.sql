-- Update RLS policies to allow access via either 'badgeuse' OR 'presence' permission
-- This enables users with presence:read to view presence data without needing badgeuse permission

-- 1) Update policy on badge_events
DROP POLICY IF EXISTS "Users can view badge events for assigned establishments (badgeu" ON public.badge_events;

CREATE POLICY "Users can view badge events for assigned establishments"
ON public.badge_events
FOR SELECT
TO authenticated
USING (
  (organization_id = get_user_organization_id()) 
  AND (
    has_module_access('badgeuse'::text, 'read'::access_level, establishment_id)
    OR has_module_access('presence'::text, 'read'::access_level, establishment_id)
  )
);

-- 2) Update policy on planning_shifts
DROP POLICY IF EXISTS "Users can view shifts for assigned establishments (badgeuse)" ON public.planning_shifts;

CREATE POLICY "Users can view shifts for assigned establishments"
ON public.planning_shifts
FOR SELECT
TO authenticated
USING (
  (organization_id = get_user_organization_id()) 
  AND (
    has_module_access('badgeuse'::text, 'read'::access_level, establishment_id)
    OR has_module_access('presence'::text, 'read'::access_level, establishment_id)
  )
);