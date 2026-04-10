
-- ═══════════════════════════════════════════════════════════════════
-- ÉTAPE 2: Log conversion errors to brain_events (observability)
-- Added in fn_ship_commande: after building _ship_lines, log any
-- conversion errors to brain_events for monitoring.
-- Non-blocking: errors still result in 'rupture', never block shipment.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_log_b2b_conversion_errors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- This is called AFTER fn_ship_commande or fn_resolve_litige
  -- to log conversion failures for monitoring.
  -- It's a standalone function triggered manually, not a table trigger.
  RETURN NULL;
END;
$$;

-- Instead, create a helper function that can be called from ship/resolve
CREATE OR REPLACE FUNCTION public.fn_log_conversion_error(
  p_establishment_id uuid,
  p_product_id uuid,
  p_client_unit_id uuid,
  p_flow text DEFAULT 'shipment'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_product_name text;
  v_client_unit_name text;
  v_supplier_unit_name text;
BEGIN
  SELECT nom_produit INTO v_product_name FROM products_v2 WHERE id = p_product_id;
  SELECT name INTO v_client_unit_name FROM measurement_units WHERE id = p_client_unit_id;
  
  INSERT INTO brain_events (establishment_id, subject, action, context)
  VALUES (
    p_establishment_id,
    'b2b_unit_conversion',
    'conversion_error',
    jsonb_build_object(
      'product_id', p_product_id,
      'product_name', v_product_name,
      'client_unit_id', p_client_unit_id,
      'client_unit_name', v_client_unit_name,
      'flow', p_flow,
      'severity', 'warning'
    )
  );
END;
$$;

-- Drop the unused trigger function
DROP FUNCTION IF EXISTS public.fn_log_b2b_conversion_errors();
