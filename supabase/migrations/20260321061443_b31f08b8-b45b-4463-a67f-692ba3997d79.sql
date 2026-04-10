-- Drop old fn_quick_adjustment overload that still uses override_flag
DROP FUNCTION IF EXISTS public.fn_quick_adjustment(uuid, uuid, uuid, uuid, uuid, numeric, numeric, uuid, text, text, text);