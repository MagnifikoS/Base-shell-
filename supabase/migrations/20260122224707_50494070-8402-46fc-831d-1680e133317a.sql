-- =====================================================
-- MIGRATION: Add gestion_personnel module + RBAC for extra_events
-- =====================================================

-- 1) Add gestion_personnel module to modules table
INSERT INTO public.modules (key, name, display_order)
VALUES ('gestion_personnel', 'Gestion du personnel', 14)
ON CONFLICT (key) DO NOTHING;

-- 2) Drop existing admin-only RLS policies on extra_events
DROP POLICY IF EXISTS "Admins can view establishment extras" ON public.extra_events;
DROP POLICY IF EXISTS "Admins can view org extras" ON public.extra_events;

-- 3) Create RBAC-based SELECT policy for extra_events
-- Allows: is_admin OR has_module_access('gestion_personnel', 'read', establishment_id)
CREATE POLICY "RBAC can view establishment extras"
ON public.extra_events
FOR SELECT
USING (
  (user_id = auth.uid())
  OR public.is_admin(auth.uid())
  OR public.has_module_access('gestion_personnel'::text, 'read'::access_level, establishment_id)
);

-- 4) Create RBAC-based UPDATE policy for extra_events (for approve/reject)
-- Allows: is_admin OR has_module_access('gestion_personnel', 'write', establishment_id)
CREATE POLICY "RBAC can update establishment extras"
ON public.extra_events
FOR UPDATE
USING (
  public.is_admin(auth.uid())
  OR public.has_module_access('gestion_personnel'::text, 'write'::access_level, establishment_id)
);