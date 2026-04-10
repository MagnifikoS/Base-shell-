-- SEC-08 / DB-01: Fix increment_counted_products — SECURITY INVOKER + auth check
-- Previous migration (20260214130000) only used ALTER FUNCTION which cannot add
-- an auth check inside the function body. This migration replaces the full function
-- with SECURITY INVOKER and an explicit authentication guard.
--
-- Original: SECURITY DEFINER (ran with definer's elevated privileges)
-- Fixed:    SECURITY INVOKER (runs with caller's permissions, RLS applies)
--
-- Idempotent: CREATE OR REPLACE is safe to re-run.

CREATE OR REPLACE FUNCTION public.increment_counted_products(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Guard: caller must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE inventory_sessions
  SET counted_products = counted_products + 1,
      updated_at = now()
  WHERE id = p_session_id;
END;
$$;

-- Restrict execution to authenticated users only
REVOKE EXECUTE ON FUNCTION public.increment_counted_products(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_counted_products(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.increment_counted_products(uuid) TO authenticated;
