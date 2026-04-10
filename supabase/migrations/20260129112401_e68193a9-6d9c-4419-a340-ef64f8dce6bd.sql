
-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX: Add RBAC V2 RLS policy for employee_details (Directeur access to paie)
-- ═══════════════════════════════════════════════════════════════════════════════
-- 
-- ROOT CAUSE: employee_details only had is_admin() policies
-- Directeurs with paie:read or salaries:read on an establishment could NOT access data
-- 
-- SOLUTION: Add V2 policy using has_module_access('salaries' OR 'paie', 'read', establishment_id)
-- The establishment_id comes from joining user_establishments
-- ═══════════════════════════════════════════════════════════════════════════════

-- Drop legacy duplicate policy if it exists (keeps cleaner)
DROP POLICY IF EXISTS "Admins only can view org employee details" ON public.employee_details;

-- Add V2 RBAC policy for SELECT on employee_details
-- Users with salaries:read OR paie:read on any establishment where the employee is assigned
CREATE POLICY "RBAC V2 can view establishment employee details"
  ON public.employee_details
  FOR SELECT
  USING (
    organization_id = public.get_user_organization_id()
    AND (
      -- Admin shortcut (legacy compatibility)
      public.is_admin(auth.uid())
      OR
      -- V2 RBAC: Check if viewer has salaries OR paie access on any establishment 
      -- where the target employee is assigned
      EXISTS (
        SELECT 1
        FROM public.user_establishments ue
        WHERE ue.user_id = employee_details.user_id
          AND (
            public.has_module_access('salaries', 'read'::public.access_level, ue.establishment_id)
            OR public.has_module_access('paie', 'read'::public.access_level, ue.establishment_id)
          )
      )
    )
  );

-- Add V2 RBAC policy for UPDATE on employee_details
-- Users with salaries:write on any establishment where the employee is assigned
CREATE POLICY "RBAC V2 can update establishment employee details"
  ON public.employee_details
  FOR UPDATE
  USING (
    organization_id = public.get_user_organization_id()
    AND (
      public.is_admin(auth.uid())
      OR
      EXISTS (
        SELECT 1
        FROM public.user_establishments ue
        WHERE ue.user_id = employee_details.user_id
          AND public.has_module_access('salaries', 'write'::public.access_level, ue.establishment_id)
      )
    )
  );

-- Add V2 RBAC policy for INSERT on employee_details
-- Only admins or users with salaries:write can insert
CREATE POLICY "RBAC V2 can insert establishment employee details"
  ON public.employee_details
  FOR INSERT
  WITH CHECK (
    organization_id = public.get_user_organization_id()
    AND (
      public.is_admin(auth.uid())
      OR
      EXISTS (
        SELECT 1
        FROM public.user_establishments ue
        WHERE ue.user_id = employee_details.user_id
          AND public.has_module_access('salaries', 'write'::public.access_level, ue.establishment_id)
      )
    )
  );
