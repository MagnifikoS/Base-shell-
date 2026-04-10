
-- SECURITY DEFINER function to return billing config for given product IDs.
-- Bypasses RLS so invoice display can access product billing info
-- regardless of which establishment the viewer belongs to.
CREATE OR REPLACE FUNCTION public.get_product_billing_config(p_product_ids uuid[])
RETURNS TABLE (
  id uuid,
  supplier_billing_unit_id uuid,
  conditionnement_config jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.supplier_billing_unit_id, p.conditionnement_config
  FROM products_v2 p
  WHERE p.id = ANY(p_product_ids);
$$;
