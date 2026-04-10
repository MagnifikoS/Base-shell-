-- V3.4.1: Fix admin policy - restrict to establishment level (not org level)
-- Rollback: DROP POLICY "Admins can view establishment extras" ON public.extra_events; CREATE POLICY "Admins can view org extras" ON public.extra_events FOR SELECT USING ((organization_id = get_user_organization_id()) AND is_admin(auth.uid()));

-- Drop the org-level policy (too permissive)
DROP POLICY IF EXISTS "Admins can view org extras" ON public.extra_events;

-- Create establishment-level policy using existing functions
CREATE POLICY "Admins can view establishment extras"
ON public.extra_events
FOR SELECT
USING (
  public.is_admin(auth.uid()) 
  AND establishment_id IN (SELECT public.get_user_establishment_ids())
);