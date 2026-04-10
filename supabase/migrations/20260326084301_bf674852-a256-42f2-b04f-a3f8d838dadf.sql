
-- ═══════════════════════════════════════════════════════════════════
-- Fix fn_convert_b2b_quantity V4.2: Restore DIVISION for price→quantity conversion
-- ═══════════════════════════════════════════════════════════════════
-- BUG: V4.1 accidentally reverted V4 fix. fn_product_unit_price_factor returns
-- a PRICE factor (e.g., Pièce→Carton = 1000 for 1 Carton = 1000 Pièces).
-- For QUANTITY conversion, we must DIVIDE:
--   10 Pièces / 1000 = 0.01 Cartons  ✅
-- NOT multiply:
--   10 Pièces * 1000 = 10000 Cartons  ❌
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
  -- V4: UUID mapping variables
  v_mapped_supplier_unit uuid;
  v_mapped_factor        numeric;
  v_client_est_id        uuid;
  v_mapping_jsonb        jsonb;
  -- V4.1: tracking
  v_resolution_method    text := 'none';
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

  -- ══════════════════════════════════════════════════════════════
  -- ── 3b. V4: UUID mapping lookup from b2b_imported_products ──
  -- ══════════════════════════════════════════════════════════════
  SELECT mu.establishment_id INTO v_client_est_id
    FROM measurement_units mu
   WHERE mu.id = p_client_unit_id;

  IF v_client_est_id IS NOT NULL THEN
    SELECT bip.unit_mapping INTO v_mapping_jsonb
      FROM b2b_imported_products bip
     WHERE bip.source_product_id = p_product_id
       AND bip.establishment_id = v_client_est_id
     LIMIT 1;

    IF v_mapping_jsonb IS NOT NULL THEN
      SELECT (kv.key)::uuid INTO v_mapped_supplier_unit
        FROM jsonb_each_text(v_mapping_jsonb) kv
       WHERE kv.value = p_client_unit_id::text
       LIMIT 1;

      IF v_mapped_supplier_unit IS NOT NULL THEN
        IF v_mapped_supplier_unit = v_supplier_unit_id THEN
          v_result.supplier_unit_id  := v_supplier_unit_id;
          v_result.supplier_quantity := p_client_quantity;
          v_result.supplier_family   := v_supplier_family;
          v_result.status            := 'ok';
          RETURN v_result;
        END IF;

        -- V4.2 FIX: DIVIDE by price factor for quantity conversion
        SELECT fn_product_unit_price_factor(p_product_id, v_mapped_supplier_unit, v_supplier_unit_id)
          INTO v_mapped_factor;

        IF v_mapped_factor IS NOT NULL AND v_mapped_factor != 0 THEN
          v_result.supplier_unit_id  := v_supplier_unit_id;
          v_result.supplier_quantity := ROUND(p_client_quantity / v_mapped_factor, 4);
          v_result.supplier_family   := v_supplier_family;
          v_result.status            := 'ok';
          RETURN v_result;
        END IF;
      END IF;
    END IF;
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- ── V4.1: LOG fallback — UUID mapping did not resolve ──
  -- ══════════════════════════════════════════════════════════════
  RAISE LOG 'B2B_FALLBACK_SQL product=% client_unit=% client_est=%',
    p_product_id, p_client_unit_id, v_client_est_id;

  -- ── 4. Try BFS conversion (direct) ──
  -- V4.2 FIX: DIVIDE by price factor for quantity conversion
  SELECT fn_product_unit_price_factor(p_product_id, p_client_unit_id, v_supplier_unit_id)
    INTO v_factor;

  IF v_factor IS NOT NULL AND v_factor != 0 THEN
    v_result.supplier_unit_id  := v_supplier_unit_id;
    v_result.supplier_quantity := ROUND(p_client_quantity / v_factor, 4);
    v_result.supplier_family   := v_supplier_family;
    v_result.status            := 'ok';
    RETURN v_result;
  END IF;

  -- ── 5. Cross-tenant same name+family → identity ──
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
        -- V4.2 FIX: DIVIDE by price factor for quantity conversion
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
