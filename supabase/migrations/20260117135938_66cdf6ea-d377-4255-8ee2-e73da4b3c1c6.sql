-- V3.4: Enable RLS on extra_events with minimal SELECT policies
-- Rollback: ALTER TABLE public.extra_events DISABLE ROW LEVEL SECURITY; DROP POLICY IF EXISTS ... ;

-- Enable RLS
ALTER TABLE public.extra_events ENABLE ROW LEVEL SECURITY;

-- Policy 1: Employees can read their own extras
CREATE POLICY "Users can view own extras"
ON public.extra_events
FOR SELECT
USING (user_id = auth.uid());

-- Policy 2: Admins can read extras for their organization
CREATE POLICY "Admins can view org extras"
ON public.extra_events
FOR SELECT
USING (
  (organization_id = get_user_organization_id()) 
  AND is_admin(auth.uid())
);

-- NO INSERT/UPDATE/DELETE policies: writes handled by Edge (service role)