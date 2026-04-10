-- Drop the OLD version (OID 71332) with original parameter order
DROP FUNCTION IF EXISTS public.fn_post_b2b_reception(uuid, jsonb, uuid, uuid, uuid);