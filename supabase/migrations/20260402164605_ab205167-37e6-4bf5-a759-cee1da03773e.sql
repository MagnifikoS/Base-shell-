
CREATE OR REPLACE FUNCTION public.fn_product_unit_price_factor(
  p_product_id uuid,
  p_from_unit_id uuid,
  p_to_unit_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config jsonb;
  v_levels jsonb;
  v_equiv jsonb;
  v_queue_units uuid[];
  v_queue_factors numeric[];
  v_visited uuid[];
  v_current_unit uuid;
  v_current_factor numeric;
  v_next_factor numeric;
  v_idx int;
  v_depth int;
  v_level jsonb;
  v_type_unit_id uuid;
  v_contains_unit_id uuid;
  v_contains_qty numeric;
  v_next_queue_units uuid[];
  v_next_queue_factors numeric[];
  v_equiv_source_id uuid;
  v_equiv_target_id uuid;
  v_equiv_qty numeric;
  rec record;
BEGIN
  IF p_from_unit_id = p_to_unit_id THEN
    RETURN 1.0;
  END IF;

  SELECT conditionnement_config INTO v_config
  FROM products_v2
  WHERE id = p_product_id;

  v_queue_units := ARRAY[p_from_unit_id];
  v_queue_factors := ARRAY[1.0::numeric];
  v_visited := ARRAY[p_from_unit_id];
  v_depth := 0;

  WHILE v_depth < 5 AND array_length(v_queue_units, 1) > 0 LOOP
    v_depth := v_depth + 1;
    v_next_queue_units := '{}'::uuid[];
    v_next_queue_factors := '{}'::numeric[];

    FOR v_idx IN 1..array_length(v_queue_units, 1) LOOP
      v_current_unit := v_queue_units[v_idx];
      v_current_factor := v_queue_factors[v_idx];

      -- 1. Packaging levels (UNCHANGED — already uses price semantics)
      IF v_config IS NOT NULL THEN
        v_levels := COALESCE(v_config->'packagingLevels', v_config->'levels');
        IF v_levels IS NOT NULL AND jsonb_typeof(v_levels) = 'array' THEN
          FOR v_level IN SELECT value FROM jsonb_array_elements(v_levels) AS value LOOP
            v_type_unit_id := COALESCE(
              (v_level->>'type_unit_id')::uuid,
              (v_level->>'unitId')::uuid
            );
            v_contains_unit_id := COALESCE(
              (v_level->>'contains_unit_id')::uuid,
              (v_level->>'containsUnitId')::uuid
            );
            v_contains_qty := COALESCE(
              (v_level->>'containsQuantity')::numeric,
              (v_level->>'quantity')::numeric
            );

            IF v_type_unit_id IS NULL OR v_contains_unit_id IS NULL OR v_contains_qty IS NULL OR v_contains_qty = 0 THEN
              CONTINUE;
            END IF;

            IF v_current_unit = v_contains_unit_id AND NOT v_type_unit_id = ANY(v_visited) THEN
              v_next_factor := v_current_factor * v_contains_qty;
              IF v_type_unit_id = p_to_unit_id THEN RETURN v_next_factor; END IF;
              v_next_queue_units := v_next_queue_units || v_type_unit_id;
              v_next_queue_factors := v_next_queue_factors || v_next_factor;
              v_visited := v_visited || v_type_unit_id;
            END IF;

            IF v_current_unit = v_type_unit_id AND NOT v_contains_unit_id = ANY(v_visited) THEN
              v_next_factor := v_current_factor / v_contains_qty;
              IF v_contains_unit_id = p_to_unit_id THEN RETURN v_next_factor; END IF;
              v_next_queue_units := v_next_queue_units || v_contains_unit_id;
              v_next_queue_factors := v_next_queue_factors || v_next_factor;
              v_visited := v_visited || v_contains_unit_id;
            END IF;
          END LOOP;
        END IF;

        -- 2. Equivalence (UNCHANGED — already uses price semantics)
        v_equiv := v_config->'equivalence';
        IF v_equiv IS NOT NULL THEN
          v_equiv_source_id := (v_equiv->>'source_unit_id')::uuid;
          v_equiv_target_id := COALESCE((v_equiv->>'unit_id')::uuid, (v_equiv->>'to_unit_id')::uuid);
          v_equiv_qty := (v_equiv->>'quantity')::numeric;

          IF v_equiv_source_id IS NOT NULL AND v_equiv_target_id IS NOT NULL AND v_equiv_qty IS NOT NULL AND v_equiv_qty > 0 THEN
            IF v_current_unit = v_equiv_source_id AND NOT v_equiv_target_id = ANY(v_visited) THEN
              v_next_factor := v_current_factor * v_equiv_qty;
              IF v_equiv_target_id = p_to_unit_id THEN RETURN v_next_factor; END IF;
              v_next_queue_units := v_next_queue_units || v_equiv_target_id;
              v_next_queue_factors := v_next_queue_factors || v_next_factor;
              v_visited := v_visited || v_equiv_target_id;
            END IF;
            IF v_current_unit = v_equiv_target_id AND NOT v_equiv_source_id = ANY(v_visited) THEN
              v_next_factor := v_current_factor / v_equiv_qty;
              IF v_equiv_source_id = p_to_unit_id THEN RETURN v_next_factor; END IF;
              v_next_queue_units := v_next_queue_units || v_equiv_source_id;
              v_next_queue_factors := v_next_queue_factors || v_next_factor;
              v_visited := v_visited || v_equiv_source_id;
            END IF;
          END IF;
        END IF;
      END IF;

      -- 3. Universal unit_conversions
      -- FIX: unit_conversions.factor is a QUANTITY factor (g * 0.001 = kg).
      -- This function returns a PRICE factor, so we must INVERT:
      --   price_per_kg = price_per_g / 0.001 = price_per_g * 1000
      -- Before this fix, the factor was applied directly (× instead of ÷),
      -- causing prices like 0.0076 €/g to become 0.0000 €/kg instead of 7.60 €/kg.
      FOR rec IN
        SELECT uc.from_unit_id, uc.to_unit_id, uc.factor
        FROM unit_conversions uc
        WHERE uc.is_active = true
          AND (uc.from_unit_id = v_current_unit OR uc.to_unit_id = v_current_unit)
      LOOP
        IF rec.from_unit_id = v_current_unit AND NOT rec.to_unit_id = ANY(v_visited) THEN
          v_next_factor := v_current_factor / rec.factor;   -- FIX: was * (quantity), now / (price)
          IF rec.to_unit_id = p_to_unit_id THEN RETURN v_next_factor; END IF;
          v_next_queue_units := v_next_queue_units || rec.to_unit_id;
          v_next_queue_factors := v_next_queue_factors || v_next_factor;
          v_visited := v_visited || rec.to_unit_id;
        ELSIF rec.to_unit_id = v_current_unit AND NOT rec.from_unit_id = ANY(v_visited) THEN
          v_next_factor := v_current_factor * rec.factor;   -- FIX: was / (quantity), now * (price)
          IF rec.from_unit_id = p_to_unit_id THEN RETURN v_next_factor; END IF;
          v_next_queue_units := v_next_queue_units || rec.from_unit_id;
          v_next_queue_factors := v_next_queue_factors || v_next_factor;
          v_visited := v_visited || rec.from_unit_id;
        END IF;
      END LOOP;

    END LOOP;

    v_queue_units := v_next_queue_units;
    v_queue_factors := v_next_queue_factors;
  END LOOP;

  RETURN NULL;
END;
$$;
