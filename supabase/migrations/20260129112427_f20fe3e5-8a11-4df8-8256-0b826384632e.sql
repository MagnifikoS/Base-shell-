
-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX: Add RBAC V2 RLS policy for user_establishments
-- ═══════════════════════════════════════════════════════════════════════════════
-- 
-- PROBLEM: Directeurs need to see which employees belong to their establishment
-- Current policies: Admin-only + self-only
-- 
-- SOLUTION: Users with gestion_personnel:read, salaries:read, paie:read, or planning:read
-- on an establishment can see all user_establishments for that establishment
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add V2 RBAC policy for SELECT on user_establishments
-- Users with relevant module access can see who is assigned to their establishment
CREATE POLICY "RBAC V2 can view establishment user assignments"
  ON public.user_establishments
  FOR SELECT
  USING (
    -- Users can always see their own assignments
    user_id = auth.uid()
    OR
    -- Admin shortcut
    public.is_admin(auth.uid())
    OR
    -- V2 RBAC: Check if viewer has relevant module access on THIS establishment
    public.has_module_access('gestion_personnel', 'read'::public.access_level, establishment_id)
    OR public.has_module_access('salaries', 'read'::public.access_level, establishment_id)
    OR public.has_module_access('paie', 'read'::public.access_level, establishment_id)
    OR public.has_module_access('planning', 'read'::public.access_level, establishment_id)
    OR public.has_module_access('presence', 'read'::public.access_level, establishment_id)
  );
