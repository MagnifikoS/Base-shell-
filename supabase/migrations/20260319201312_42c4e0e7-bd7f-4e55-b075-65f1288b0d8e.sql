
-- ═══════════════════════════════════════════════════════════════════
-- Fix fn_convert_b2b_quantity: handle cross-tenant same-name units
-- ═══════════════════════════════════════════════════════════════════
-- Problem: BFS fails when client UUID is foreign to supplier's 
-- conditionnement_config graph. But if units have same name+family,
-- the conversion is identity (factor=1).
--
-- Strategy:
-- 1. Same UUID → identity (existing)
-- 2. BFS path found → use factor (existing)
-- 3. Same name+family → identity (NEW - cross-tenant safe case)
-- 4. None of the above → error (existing)
-- ═══════════════════════════════════════════════════════════════════

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
  v_supplier_name    text;
  v_client_family    text;
  v_client_name      text;
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

  -- ── 2. Get supplier unit metadata ──
  SELECT mu.family, mu.name
    INTO v_supplier_family, v_supplier_name
    FROM measurement_units mu
   WHERE mu.id = v_supplier_unit_id;

  IF v_supplier_family IS NULL THEN
    v_result.status := 'error';
    RETURN v_result;
  END IF;

  -- ── 3. Same UUID → identity ──
  IF p_client_unit_id = v_supplier_unit_id THEN
    v_result.supplier_unit_id  := v_supplier_unit_id;
    v_result.supplier_quantity := p_client_quantity;
    v_result.supplier_family   := v_supplier_family;
    v_result.status            := 'ok';
    RETURN v_result;
  END IF;

  -- ── 4. Try BFS conversion ──
  SELECT fn_product_unit_price_factor(p_product_id, p_client_unit_id, v_supplier_unit_id)
    INTO v_factor;

  IF v_factor IS NOT NULL AND v_factor != 0 THEN
    v_result.supplier_unit_id  := v_supplier_unit_id;
    v_result.supplier_quantity := ROUND(p_client_quantity * v_factor, 4);
    v_result.supplier_family   := v_supplier_family;
    v_result.status            := 'ok';
    RETURN v_result;
  END IF;

  -- ── 5. NEW: Cross-tenant same name+family → identity ──
  -- Client UUID is foreign to supplier's config graph, but if the 
  -- unit has the exact same name and family, the quantity is identical.
  SELECT mu.family, mu.name
    INTO v_client_family, v_client_name
    FROM measurement_units mu
   WHERE mu.id = p_client_unit_id;

  IF v_client_name IS NOT NULL 
     AND lower(trim(v_client_name)) = lower(trim(v_supplier_name))
     AND v_client_family = v_supplier_family THEN
    v_result.supplier_unit_id  := v_supplier_unit_id;
    v_result.supplier_quantity := p_client_quantity;
    v_result.supplier_family   := v_supplier_family;
    v_result.status            := 'ok';
    RETURN v_result;
  END IF;

  -- ── 6. No conversion path → error ──
  v_result.status := 'error';
  RETURN v_result;
END;
$$;
