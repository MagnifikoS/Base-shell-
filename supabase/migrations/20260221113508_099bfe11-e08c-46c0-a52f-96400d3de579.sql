
-- ═══════════════════════════════════════════════════════════════════════════
-- PUSH SUBSCRIPTIONS: Employees cannot delete/update their own subscriptions
-- Only users with alertes >= read can delete/update (admin/manager)
-- ═══════════════════════════════════════════════════════════════════════════

-- Security definer function: check if user has alertes module access >= read
CREATE OR REPLACE FUNCTION public.has_alertes_read_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = _user_id
      AND rp.module_key = 'alertes'
      AND rp.access_level IN ('read', 'write', 'full')
  )
  OR public.is_admin(_user_id)
$$;

-- Drop existing DELETE policy
DROP POLICY IF EXISTS "Users can delete own push subscriptions" ON public.push_subscriptions;

-- New DELETE policy: only users with alertes access (admin/manager) can delete
CREATE POLICY "Only managers can delete push subscriptions"
ON public.push_subscriptions
FOR DELETE
USING (
  auth.uid() = user_id
  AND public.has_alertes_read_access(auth.uid())
);

-- Drop existing UPDATE policy if any, and create restricted one
DROP POLICY IF EXISTS "Users can update own push subscriptions" ON public.push_subscriptions;

CREATE POLICY "Only managers can update push subscriptions"
ON public.push_subscriptions
FOR UPDATE
USING (
  auth.uid() = user_id
  AND public.has_alertes_read_access(auth.uid())
);
