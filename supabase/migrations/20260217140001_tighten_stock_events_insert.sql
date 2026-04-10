-- ═══════════════════════════════════════════════════════════════════════════
-- DB-RLS-002: Tighten stock_events INSERT RLS policy
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Problem:
--   The original INSERT policy on stock_events allows any authenticated user
--   in the establishment to insert rows directly via PostgREST:
--
--     CREATE POLICY "Users can insert stock events in their establishments"
--       ON public.stock_events FOR INSERT
--       WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));
--
--   stock_events is an append-only ledger and should ONLY be written by the
--   stock posting functions (fn_post_stock_document, fn_void_stock_document)
--   which are SECURITY DEFINER and called from the stock-ledger edge function.
--
--   Direct INSERT from authenticated clients bypasses the posting guards
--   (document status checks, snapshot validation, locking, etc.).
--
-- Solution:
--   Replace the permissive INSERT policy with one that only allows the
--   service_role (used by edge functions) to insert. The SECURITY DEFINER
--   functions run as the function owner and bypass RLS, so they are
--   unaffected by this change.
--
-- Impact:
--   - Edge functions using service_role: UNAFFECTED (bypass RLS)
--   - fn_post_stock_document / fn_void_stock_document: UNAFFECTED (SECURITY DEFINER)
--   - Direct PostgREST INSERT by authenticated users: BLOCKED (desired)
--
-- References:
--   - Original: 20260212155624_51d66c13-012d-4924-8982-82c1917327e4.sql
--   - RPC revocation: 20260216230003_revoke_stock_rpc_direct_access.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the overly permissive INSERT policy
DROP POLICY IF EXISTS "Users can insert stock events in their establishments"
  ON public.stock_events;

-- Create restrictive INSERT policy: only service_role can insert directly.
-- In practice, inserts happen via SECURITY DEFINER functions (which bypass RLS)
-- or via service_role from edge functions. This policy is a safety net to
-- prevent direct client-side inserts through PostgREST.
--
-- Note: We use a WITH CHECK that always returns false for normal roles.
-- Service role bypasses RLS entirely, and SECURITY DEFINER functions
-- also bypass RLS, so both paths remain functional.
CREATE POLICY "Stock events insert restricted to service role"
  ON public.stock_events
  FOR INSERT
  WITH CHECK (false);

COMMENT ON POLICY "Stock events insert restricted to service role" ON public.stock_events IS
  'DB-RLS-002: Direct INSERT blocked for authenticated users. '
  'Inserts happen via SECURITY DEFINER posting functions or service_role edge functions.';
