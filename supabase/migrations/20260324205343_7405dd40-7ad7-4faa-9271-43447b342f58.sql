
-- ═══════════════════════════════════════════════════════════════════
-- Fix fn_convert_b2b_quantity V4: Correct factor direction
-- ═══════════════════════════════════════════════════════════════════
-- BUG: fn_product_unit_price_factor returns a PRICE factor
--   (e.g., Carton→Pièce = 0.005 = 1/200)
-- But fn_convert_b2b_quantity used it as a QUANTITY factor:
--   qty * 0.005 = 0.0013  ❌
-- FIX: Use DIVISION instead of multiplication:
--   qty / 0.005 = 50     ✅
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
  v_config           jsonb;
  v_config_unit_ids  uuid[];
  v_local_match_id   uuid;
  v_local_factor     numeric;
BEGIN
  -- ── 1. Get supplier's stock handling unit ──
  SELECT p.stock_handling_unit_id, p.conditionnement_config
    INTO v_supplier_unit_id, v_config
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

  -- ── 4. Try BFS conversion (direct) ──
  -- NOTE V4: fn_product_unit_price_factor returns a PRICE factor.
  -- For quantity conversion, we DIVIDE instead of multiply.
  SELECT fn_product_unit_price_factor(p_product_id, p_client_unit_id, v_supplier_unit_id)
    INTO v_factor;

  IF v_factor IS NOT NULL AND v_factor != 0 THEN
    v_result.supplier_unit_id  := v_supplier_unit_id;
    v_result.supplier_quantity := ROUND(p_client_quantity / v_factor, 4);
    v_result.supplier_family   := v_supplier_family;
    v_result.status            := 'ok';
    RETURN v_result;
  END IF;

  -- ── 5. Cross-tenant same name+family → identity (no conversion needed) ──
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

  -- ── 6. Remap client UUID via product config ──
  IF v_config IS NOT NULL AND v_client_name IS NOT NULL THEN
    SELECT array_agg(DISTINCT uid) INTO v_config_unit_ids
    FROM (
      SELECT (el->>'type_unit_id')::uuid as uid
      FROM jsonb_array_elements(COALESCE(v_config->'packagingLevels', '[]'::jsonb)) el
      WHERE el->>'type_unit_id' IS NOT NULL
      UNION
      SELECT (el->>'contains_unit_id')::uuid as uid
      FROM jsonb_array_elements(COALESCE(v_config->'packagingLevels', '[]'::jsonb)) el
      WHERE el->>'contains_unit_id' IS NOT NULL
      UNION
      SELECT (v_config->'equivalence'->>'source_unit_id')::uuid as uid
      WHERE v_config->'equivalence'->>'source_unit_id' IS NOT NULL
      UNION
      SELECT (v_config->'equivalence'->>'unit_id')::uuid as uid
      WHERE v_config->'equivalence'->>'unit_id' IS NOT NULL
      UNION
      SELECT v_supplier_unit_id as uid
    ) all_uids WHERE uid IS NOT NULL;

    IF v_config_unit_ids IS NOT NULL THEN
      SELECT mu.id INTO v_local_match_id
      FROM measurement_units mu
      WHERE mu.id = ANY(v_config_unit_ids)
        AND lower(trim(mu.name)) = lower(trim(v_client_name))
        AND mu.family = v_client_family
      LIMIT 1;

      IF v_local_match_id IS NOT NULL THEN
        -- NOTE V4: DIVIDE by price factor for quantity conversion
        SELECT fn_product_unit_price_factor(p_product_id, v_local_match_id, v_supplier_unit_id)
          INTO v_local_factor;

        IF v_local_factor IS NOT NULL AND v_local_factor != 0 THEN
          v_result.supplier_unit_id  := v_supplier_unit_id;
          v_result.supplier_quantity := ROUND(p_client_quantity / v_local_factor, 4);
          v_result.supplier_family   := v_supplier_family;
          v_result.status            := 'ok';
          RETURN v_result;
        END IF;

        IF v_local_match_id = v_supplier_unit_id THEN
          v_result.supplier_unit_id  := v_supplier_unit_id;
          v_result.supplier_quantity := p_client_quantity;
          v_result.supplier_family   := v_supplier_family;
          v_result.status            := 'ok';
          RETURN v_result;
        END IF;
      END IF;
    END IF;
  END IF;

  -- ── 7. No conversion path → error ──
  v_result.status := 'error';
  RETURN v_result;
END;
$$;
