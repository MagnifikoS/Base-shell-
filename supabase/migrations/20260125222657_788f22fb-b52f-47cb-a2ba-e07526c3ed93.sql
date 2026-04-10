-- ══════════════════════════════════════════════════════════════════════════════
-- FIX CRITIQUE: personnel_leaves WRITE ALIGNMENT (Ligne Droite, RBAC V2)
-- ══════════════════════════════════════════════════════════════════════════════
-- Objectif: Permettre aux utilisateurs avec planning:write de gérer les congés
-- de leur établissement (INSERT/UPDATE/DELETE) via has_module_access.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1) INSERT policy for planning writers
CREATE POLICY "Planning writers can insert establishment leaves"
ON public.personnel_leaves
FOR INSERT
TO authenticated
WITH CHECK (
  has_module_access('planning'::text, 'write'::access_level, establishment_id)
);

-- 2) UPDATE policy for planning writers
CREATE POLICY "Planning writers can update establishment leaves"
ON public.personnel_leaves
FOR UPDATE
TO authenticated
USING (
  has_module_access('planning'::text, 'write'::access_level, establishment_id)
)
WITH CHECK (
  has_module_access('planning'::text, 'write'::access_level, establishment_id)
);

-- 3) DELETE policy for planning writers
CREATE POLICY "Planning writers can delete establishment leaves"
ON public.personnel_leaves
FOR DELETE
TO authenticated
USING (
  has_module_access('planning'::text, 'write'::access_level, establishment_id)
);