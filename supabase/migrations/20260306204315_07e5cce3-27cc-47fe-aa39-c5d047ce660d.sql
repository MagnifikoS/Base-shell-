
-- Fix search_path on new functions
ALTER FUNCTION fn_validate_threshold_product() SET search_path = public;
ALTER FUNCTION fn_clear_threshold_on_unlink() SET search_path = public;
