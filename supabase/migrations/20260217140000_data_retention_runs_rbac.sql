-- ═══════════════════════════════════════════════════════════════════════════
-- DB-RLS-001: Update data_retention_runs SELECT policy to use has_module_access
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The original policy used is_admin(auth.uid()) which is the legacy RBAC check.
-- This migration updates it to use has_module_access() which is the V2 RBAC
-- system, with a fallback to is_admin() for backward compatibility.
--
-- References:
--   - Original migration: 20260214150100_data_retention_tracking.sql
--   - RBAC V2: has_module_access(_module_key, _min_level, _establishment_id)
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the old policy
DROP POLICY IF EXISTS "Admins can view retention runs" ON public.data_retention_runs;

-- Create updated policy using has_module_access with is_admin fallback
-- Since data_retention_runs is org-wide (no establishment_id column),
-- we check if the user has admin access to ANY of their establishments,
-- or falls back to the legacy is_admin() check.
CREATE POLICY "Admins can view retention runs"
ON public.data_retention_runs
FOR SELECT
USING (
  -- V2 RBAC: check if user has admin write access to any assigned establishment
  EXISTS (
    SELECT 1
    FROM public.user_establishments ue
    WHERE ue.user_id = auth.uid()
      AND public.has_module_access('admin', 'read', ue.establishment_id)
  )
  -- Fallback: legacy is_admin check for backward compatibility
  OR public.is_admin(auth.uid())
);

COMMENT ON POLICY "Admins can view retention runs" ON public.data_retention_runs IS
  'DB-RLS-001: Uses has_module_access (V2 RBAC) with is_admin fallback for backward compat.';
