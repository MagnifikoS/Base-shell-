
-- ══════════════════════════════════════════════════════════════
-- FIX: Allow users with planning read access to see establishment leaves
-- This enables directors to see team leaves in the planning grid
-- ══════════════════════════════════════════════════════════════

-- New policy: Users with planning read access can see leaves in their establishment
CREATE POLICY "Planning readers can view establishment leaves"
ON public.personnel_leaves
FOR SELECT
USING (
  has_module_access('planning'::text, 'read'::access_level, establishment_id)
);
