-- Drop the 3 old overloads of fn_save_product_wizard, keeping only the latest (oid 120295)
-- Overload 1: without p_category_id, p_dlc_warning_days, p_supplier_billing_quantity, p_supplier_billing_line_total
DROP FUNCTION IF EXISTS public.fn_save_product_wizard(
  uuid, uuid, text, text, text, jsonb, text, uuid, numeric, uuid, uuid, uuid, uuid, uuid, numeric, uuid, text, uuid, uuid, numeric, uuid, text, text, timestamptz
);

-- Overload 2: with p_category_id only
DROP FUNCTION IF EXISTS public.fn_save_product_wizard(
  uuid, uuid, text, text, text, jsonb, text, uuid, numeric, uuid, uuid, uuid, uuid, uuid, numeric, uuid, text, uuid, uuid, numeric, uuid, text, text, timestamptz, uuid
);

-- Overload 3: with p_category_id + p_dlc_warning_days
DROP FUNCTION IF EXISTS public.fn_save_product_wizard(
  uuid, uuid, text, text, text, jsonb, text, uuid, numeric, uuid, uuid, uuid, uuid, uuid, numeric, uuid, text, uuid, uuid, numeric, uuid, text, text, timestamptz, uuid, integer
);