
-- ═══════════════════════════════════════════════════════════════════
-- fn_convert_b2b_quantity
-- ═══════════════════════════════════════════════════════════════════
-- SSOT: Central B2B conversion function.
-- Converts a client quantity/unit into the supplier's local unit/quantity
-- using the BFS engine (fn_product_unit_price_factor).
--
-- Returns a composite: (supplier_unit_id, supplier_quantity, supplier_family, status)
-- status = 'ok' | 'error'
-- If conversion is impossible → status='error', quantities are NULL.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Create the return type
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'b2b_conversion_result') THEN
    CREATE TYPE public.b2b_conversion_result AS (
      supplier_unit_id   uuid,
      supplier_quantity  numeric,
      supplier_family    text,
      status             text
    );
  END IF;
END $$;

-- 2. Create the function
CREATE OR REPLACE FUNCTION public.fn_convert_b2b_quantity(
  p_product_id     uuid,
  p_client_unit_id uuid,
  p_client_quantity numeric
)
RETURNS public.b2b_conversion_result
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier_unit_id uuid;
  v_supplier_family  text;
  v_factor           numeric;
  v_result           public.b2b_conversion_result;
BEGIN
  -- ── 1. Get supplier's stock handling unit ──
  SELECT p.stock_handling_unit_id
    INTO v_supplier_unit_id
    FROM products_v2 p
   WHERE p.id = p_product_id;

  IF v_supplier_unit_id IS NULL THEN
    v_result.status := 'error';
    RETURN v_result;
  END IF;

  -- ── 2. Get supplier unit family ──
  SELECT mu.family
    INTO v_supplier_family
    FROM measurement_units mu
   WHERE mu.id = v_supplier_unit_id;

  IF v_supplier_family IS NULL THEN
    v_result.status := 'error';
    RETURN v_result;
  END IF;

  -- ── 3. Same unit → identity ──
  IF p_client_unit_id = v_supplier_unit_id THEN
    v_result.supplier_unit_id  := v_supplier_unit_id;
    v_result.supplier_quantity := p_client_quantity;
    v_result.supplier_family   := v_supplier_family;
    v_result.status            := 'ok';
    RETURN v_result;
  END IF;

  -- ── 4. BFS conversion ──
  SELECT fn_product_unit_price_factor(p_product_id, p_client_unit_id, v_supplier_unit_id)
    INTO v_factor;

  IF v_factor IS NULL OR v_factor = 0 THEN
    -- No conversion path found → hard block
    v_result.status := 'error';
    RETURN v_result;
  END IF;

  -- ── 5. Apply conversion with 4-decimal rounding ──
  v_result.supplier_unit_id  := v_supplier_unit_id;
  v_result.supplier_quantity := ROUND(p_client_quantity * v_factor, 4);
  v_result.supplier_family   := v_supplier_family;
  v_result.status            := 'ok';
  RETURN v_result;
END;
$$;

-- Grant execute to authenticated users (needed for RPC calls from edge functions)
GRANT EXECUTE ON FUNCTION public.fn_convert_b2b_quantity(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_convert_b2b_quantity(uuid, uuid, numeric) TO service_role;
