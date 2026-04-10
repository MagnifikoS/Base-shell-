
-- Drop the OLD overload with swapped parameter order (idempotency_key before posted_by)
-- This is the version WITHOUT defaults that causes "function is not unique" errors
DROP FUNCTION IF EXISTS public.fn_post_stock_document(
  uuid,   -- p_document_id
  integer, -- p_expected_lock_version
  text,    -- p_idempotency_key (was 3rd param in old version)
  uuid,    -- p_posted_by (was 4th param in old version)
  text,    -- p_event_reason
  boolean, -- p_override_flag
  text     -- p_override_reason
);
