-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: Workflow Demandes Congés & Absences
-- 
-- 1. Index unique anti-doublon (pending requests only)
-- 2. RLS INSERT self pour salarié (conges_absences:read)
-- 3. RLS UPDATE manager pour validation (conges_absences:write)
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. INDEX UNIQUE ANTI-DOUBLON (idempotent)
-- Empêche 2 demandes pending sur le même jour pour le même user/établissement/type
-- ═══════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS idx_personnel_leave_requests_pending_unique
ON public.personnel_leave_requests (establishment_id, user_id, leave_date, leave_type)
WHERE status = 'pending';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. RLS INSERT SELF (salarié avec conges_absences:read peut créer SA demande)
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Self can insert leave request" ON public.personnel_leave_requests;

CREATE POLICY "Self can insert leave request"
ON public.personnel_leave_requests
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND has_module_access('conges_absences', 'read'::access_level, establishment_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RLS UPDATE MANAGER (conges_absences:write pour approve/reject)
-- Remplace les anciennes policies basées sur gestion_personnel/planning
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "RBAC V2 can update establishment leave requests" ON public.personnel_leave_requests;
DROP POLICY IF EXISTS "Admins can update establishment leave requests" ON public.personnel_leave_requests;

CREATE POLICY "Manager can update leave requests"
ON public.personnel_leave_requests
FOR UPDATE
TO authenticated
USING (
  has_module_access('conges_absences', 'write'::access_level, establishment_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. RLS SELECT (cleanup: ensure salarié can see own + manager can see scope)
-- Keep existing "Users can view own leave requests" policy
-- Add manager read policy based on conges_absences module
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "RBAC V2 can view establishment leave requests" ON public.personnel_leave_requests;
DROP POLICY IF EXISTS "Admins can view establishment leave requests" ON public.personnel_leave_requests;

CREATE POLICY "Manager can view leave requests"
ON public.personnel_leave_requests
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR has_module_access('conges_absences', 'read'::access_level, establishment_id)
);