
-- =====================================================
-- RBAC V2 PROD CLEANUP - Remove V1 hardlocks on business tables
-- Safe migration: adds V2 policies, removes redundant V1-only policies
-- =====================================================

-- =====================================================
-- 1. planning_shifts: V2 policy already exists, drop V1-only admin policy
-- =====================================================
DROP POLICY IF EXISTS "Admins can view org shifts" ON public.planning_shifts;

-- Add planning:read as additional access path (V2)
DROP POLICY IF EXISTS "RBAC V2 planning readers can view shifts" ON public.planning_shifts;
CREATE POLICY "RBAC V2 planning readers can view shifts"
ON public.planning_shifts FOR SELECT
USING (
  organization_id = get_user_organization_id()
  AND has_module_access('planning', 'read', establishment_id)
);

-- =====================================================
-- 2. planning_weeks: Add V2 policy, keep V1 as fallback temporarily
-- =====================================================
DROP POLICY IF EXISTS "RBAC V2 planning readers can view weeks" ON public.planning_weeks;
CREATE POLICY "RBAC V2 planning readers can view weeks"
ON public.planning_weeks FOR SELECT
USING (
  organization_id = get_user_organization_id()
  AND has_module_access('planning', 'read', establishment_id)
);

-- =====================================================
-- 3. personnel_leave_requests: Add V2 policies for gestion_personnel
-- =====================================================
DROP POLICY IF EXISTS "RBAC V2 can view establishment leave requests" ON public.personnel_leave_requests;
CREATE POLICY "RBAC V2 can view establishment leave requests"
ON public.personnel_leave_requests FOR SELECT
USING (
  user_id = auth.uid()
  OR has_module_access('gestion_personnel', 'read', establishment_id)
  OR has_module_access('planning', 'read', establishment_id)
);

DROP POLICY IF EXISTS "RBAC V2 can update establishment leave requests" ON public.personnel_leave_requests;
CREATE POLICY "RBAC V2 can update establishment leave requests"
ON public.personnel_leave_requests FOR UPDATE
USING (
  has_module_access('gestion_personnel', 'write', establishment_id)
  OR has_module_access('planning', 'write', establishment_id)
);

-- =====================================================
-- 4. badgeuse_settings: Add V2 write policy for parametres module
-- =====================================================
DROP POLICY IF EXISTS "RBAC V2 can manage badgeuse settings" ON public.badgeuse_settings;
CREATE POLICY "RBAC V2 can manage badgeuse settings"
ON public.badgeuse_settings FOR ALL
USING (
  organization_id = get_user_organization_id()
  AND has_module_access('parametres', 'write', establishment_id)
)
WITH CHECK (
  organization_id = get_user_organization_id()
  AND has_module_access('parametres', 'write', establishment_id)
);

-- =====================================================
-- 5. extra_events: Clean up to pure V2 (remove is_admin fallback)
-- =====================================================
DROP POLICY IF EXISTS "RBAC can view establishment extras" ON public.extra_events;
CREATE POLICY "RBAC V2 can view establishment extras"
ON public.extra_events FOR SELECT
USING (
  user_id = auth.uid()
  OR has_module_access('gestion_personnel', 'read', establishment_id)
  OR has_module_access('presence', 'read', establishment_id)
);

DROP POLICY IF EXISTS "RBAC can update establishment extras" ON public.extra_events;
CREATE POLICY "RBAC V2 can update establishment extras"
ON public.extra_events FOR UPDATE
USING (
  has_module_access('gestion_personnel', 'write', establishment_id)
  OR has_module_access('presence', 'write', establishment_id)
);

-- =====================================================
-- 6. badge_events: Drop redundant V1 policy (V2 policy exists)
-- =====================================================
DROP POLICY IF EXISTS "Admins can view org badge events" ON public.badge_events;

-- =====================================================
-- 7. user_establishments: Clean V2 policy to remove is_admin fallback
-- Already has V2, just needs cleanup - recreate without is_admin
-- =====================================================
DROP POLICY IF EXISTS "RBAC V2 can view establishment user assignments" ON public.user_establishments;
CREATE POLICY "RBAC V2 can view establishment user assignments"
ON public.user_establishments FOR SELECT
USING (
  user_id = auth.uid()
  OR has_module_access('gestion_personnel', 'read', establishment_id)
  OR has_module_access('salaries', 'read', establishment_id)
  OR has_module_access('paie', 'read', establishment_id)
  OR has_module_access('planning', 'read', establishment_id)
  OR has_module_access('presence', 'read', establishment_id)
  OR has_module_access('badgeuse', 'read', establishment_id)
);

-- =====================================================
-- 8. employee_details: Clean V2 policies to remove is_admin fallback
-- =====================================================
DROP POLICY IF EXISTS "RBAC V2 can view establishment employee details" ON public.employee_details;
CREATE POLICY "RBAC V2 can view establishment employee details"
ON public.employee_details FOR SELECT
USING (
  organization_id = get_user_organization_id()
  AND (
    EXISTS (
      SELECT 1 FROM public.user_establishments ue
      WHERE ue.user_id = employee_details.user_id
        AND (
          has_module_access('salaries', 'read', ue.establishment_id)
          OR has_module_access('paie', 'read', ue.establishment_id)
        )
    )
  )
);

DROP POLICY IF EXISTS "RBAC V2 can insert establishment employee details" ON public.employee_details;
CREATE POLICY "RBAC V2 can insert establishment employee details"
ON public.employee_details FOR INSERT
WITH CHECK (
  organization_id = get_user_organization_id()
  AND (
    EXISTS (
      SELECT 1 FROM public.user_establishments ue
      WHERE ue.user_id = employee_details.user_id
        AND has_module_access('salaries', 'write', ue.establishment_id)
    )
  )
);

DROP POLICY IF EXISTS "RBAC V2 can update establishment employee details" ON public.employee_details;
CREATE POLICY "RBAC V2 can update establishment employee details"
ON public.employee_details FOR UPDATE
USING (
  organization_id = get_user_organization_id()
  AND (
    EXISTS (
      SELECT 1 FROM public.user_establishments ue
      WHERE ue.user_id = employee_details.user_id
        AND has_module_access('salaries', 'write', ue.establishment_id)
    )
  )
);
