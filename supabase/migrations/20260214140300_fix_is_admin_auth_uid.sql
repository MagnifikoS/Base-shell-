-- DB-04: Harden is_admin() to prevent privilege-check abuse
--
-- Current state (from migration 20260110124853):
--   CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
--   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
--   AS $$ SELECT public.has_role(_user_id, 'Administrateur') $$;
--
-- Problem: Any authenticated user can call is_admin(some_other_user_id) to probe
-- whether another user is an admin. While this doesn't grant escalated permissions
-- directly, it leaks role information and is called in SECURITY DEFINER context
-- (bypassing RLS on user_roles).
--
-- Fix: Keep the _user_id parameter for backward compatibility (many RLS policies
-- call is_admin(auth.uid())), but enforce that _user_id MUST equal auth.uid().
-- If called with a different user_id, return false immediately.
--
-- Also switch to SECURITY INVOKER since has_role() is already SECURITY DEFINER
-- and will handle the cross-table lookup. This reduces the attack surface.
--
-- Backward compatible: All existing callers use is_admin(auth.uid()) which
-- will continue to work identically.

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow checking own admin status
  -- All legitimate callers use is_admin(auth.uid())
  IF _user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  RETURN public.has_role(_user_id, 'Administrateur');
END;
$$;

-- Note: We keep SECURITY DEFINER here because has_role() queries user_roles
-- which has RLS that itself calls is_admin() — switching to INVOKER would
-- create an infinite recursion. The auth.uid() check above prevents abuse.
