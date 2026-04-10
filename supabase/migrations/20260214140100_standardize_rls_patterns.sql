-- DB-02: Standardize RLS patterns across critical tables
--
-- Problem: Some tables still have legacy V1 RLS policies using is_admin(auth.uid())
-- alongside newer V2 policies using has_module_access(). This creates confusion
-- and potential security gaps where V1 policies are more permissive than intended.
--
-- This migration:
-- 1. Drops remaining V1 is_admin-based policies on critical tables
-- 2. Ensures all critical tables use consistent has_module_access() V2 pattern
-- 3. Keeps self-access policies (user_id = auth.uid()) where appropriate
--
-- Pattern: organization_id = get_user_organization_id() AND has_module_access(...)
-- All policies are idempotent (DROP IF EXISTS before CREATE).

-- =====================================================
-- 1. employee_details: Drop legacy V1 policies (V2 already exists from 20260129)
-- =====================================================
DROP POLICY IF EXISTS "Admins can view org employee details" ON public.employee_details;
DROP POLICY IF EXISTS "Admins can insert org employee details" ON public.employee_details;
DROP POLICY IF EXISTS "Admins can update org employee details" ON public.employee_details;

-- =====================================================
-- 2. badgeuse_settings: Drop legacy V1 admin policy (V2 exists from 20260129)
-- =====================================================
DROP POLICY IF EXISTS "Admins can manage settings" ON public.badgeuse_settings;

-- =====================================================
-- 3. planning_weeks: Drop legacy V1 admin policy (V2 exists from 20260129)
-- =====================================================
DROP POLICY IF EXISTS "Admins can view org weeks" ON public.planning_weeks;

-- =====================================================
-- 4. badge_events_duplicates_archive: Migrate from is_admin to has_module_access
-- Admin audit table — only users with presence:read should see it
-- =====================================================
DROP POLICY IF EXISTS "Admins can view archive for audit" ON public.badge_events_duplicates_archive;
CREATE POLICY "RBAC V2 can view badge archive for audit"
ON public.badge_events_duplicates_archive
FOR SELECT
USING (
  public.has_module_access('presence', 'read'::access_level, establishment_id)
  OR public.has_module_access('badgeuse', 'read'::access_level, establishment_id)
);

-- =====================================================
-- 5. payroll_daily_costs: Ensure V2 pattern consistency
-- SKIP: Table may not exist in fresh installs (created dynamically)
-- =====================================================
-- DROP POLICY IF EXISTS "Admins can view org daily costs" ON public.payroll_daily_costs;

-- =====================================================
-- 6. user_devices: Standardize admin policy to V2 pattern
-- Currently uses is_admin + profiles subquery; replace with has_module_access
-- =====================================================
DROP POLICY IF EXISTS "Admins can view org user devices" ON public.user_devices;
CREATE POLICY "RBAC V2 can view org user devices"
ON public.user_devices
FOR SELECT
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.user_establishments ue
    WHERE ue.user_id = user_devices.user_id
      AND (
        public.has_module_access('badgeuse', 'read'::access_level, ue.establishment_id)
        OR public.has_module_access('presence', 'read'::access_level, ue.establishment_id)
      )
  )
);

-- Also drop any overlapping old "Users can view own devices" that might conflict
-- with the new combined policy above (keep it — self-access is separate concern)
-- No action needed: "Users can view own devices" uses user_id = auth.uid() which is fine.

-- =====================================================
-- 7. establishments: Standardize admin update policy
-- =====================================================
DROP POLICY IF EXISTS "Admins can update establishments" ON public.establishments;
CREATE POLICY "RBAC V2 admins can update establishments"
ON public.establishments
FOR UPDATE
USING (
  organization_id = public.get_user_organization_id()
  AND public.has_module_access('parametres', 'write'::access_level, id)
)
WITH CHECK (
  organization_id = public.get_user_organization_id()
  AND public.has_module_access('parametres', 'write'::access_level, id)
);
