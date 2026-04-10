-- Drop the OLD 3-parameter overload that still exists
DROP FUNCTION IF EXISTS public.fn_initialize_product_stock(uuid, uuid, numeric);
