-- ═══════════════════════════════════════════════════════════════════════════
-- SEC-AUTH-006/018: Revoke direct RPC access to stock posting functions
-- ═══════════════════════════════════════════════════════════════════════════
--
-- fn_post_stock_document and fn_void_stock_document are SECURITY DEFINER
-- functions that bypass RLS. They should ONLY be callable via edge functions
-- (which use the service_role key), not directly by authenticated users
-- via the PostgREST RPC endpoint.
--
-- Current signatures (from latest migrations):
--   fn_post_stock_document(uuid, integer, text, uuid, text, boolean, text)
--   fn_void_stock_document(uuid, uuid, text)
--
-- After this migration, only service_role can call these functions.
-- The edge functions (stock-post, stock-void) use service_role and will
-- continue to work. Direct client-side RPC calls will fail with 403.
-- ═══════════════════════════════════════════════════════════════════════════

-- Revoke from authenticated role (blocks direct PostgREST RPC calls)
REVOKE EXECUTE ON FUNCTION public.fn_post_stock_document(uuid, integer, text, uuid, text, boolean, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_void_stock_document(uuid, uuid, text) FROM authenticated;

-- Also revoke from anon to be thorough (should never have had access, but defensive)
REVOKE EXECUTE ON FUNCTION public.fn_post_stock_document(uuid, integer, text, uuid, text, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_void_stock_document(uuid, uuid, text) FROM anon;

-- Revoke from public role (PostgreSQL grants EXECUTE to public by default on new functions)
REVOKE EXECUTE ON FUNCTION public.fn_post_stock_document(uuid, integer, text, uuid, text, boolean, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.fn_void_stock_document(uuid, uuid, text) FROM public;
