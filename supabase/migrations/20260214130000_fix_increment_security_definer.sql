-- SEC-08: Change increment_counted_products from SECURITY DEFINER to SECURITY INVOKER
-- This ensures the function runs with the caller's permissions, not the definer's.
-- RLS policies will properly apply to the calling user.

ALTER FUNCTION increment_counted_products(uuid) SECURITY INVOKER;
