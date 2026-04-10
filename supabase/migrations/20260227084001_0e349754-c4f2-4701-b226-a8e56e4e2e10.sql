
-- Fix search_path for Step 2 functions (security linter compliance)
ALTER FUNCTION fn_is_cross_org_order(UUID) SET search_path = public;
ALTER FUNCTION fn_trg_b2b_close_guard() SET search_path = public;
ALTER FUNCTION fn_trg_b2b_status_transition_guard() SET search_path = public;
ALTER FUNCTION fn_trg_b2b_line_deletion_guard() SET search_path = public;
ALTER FUNCTION fn_trg_b2b_mapping_guard() SET search_path = public;
