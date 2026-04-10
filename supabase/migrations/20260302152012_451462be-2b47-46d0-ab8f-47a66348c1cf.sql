
-- Trigger: block cross-establishment unit IDs in conditionnement_config
CREATE OR REPLACE FUNCTION public.fn_validate_product_unit_isolation()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
DECLARE
  v_unit_id uuid;
  v_unit_est uuid;
  v_level jsonb;
BEGIN
  -- Only check if conditionnement_config is set
  IF NEW.conditionnement_config IS NULL OR NEW.conditionnement_config::text = 'null' THEN
    RETURN NEW;
  END IF;

  -- Check final_unit_id inside config
  v_unit_id := (NEW.conditionnement_config->>'final_unit_id')::uuid;
  IF v_unit_id IS NOT NULL THEN
    SELECT establishment_id INTO v_unit_est FROM measurement_units WHERE id = v_unit_id;
    IF v_unit_est IS DISTINCT FROM NEW.establishment_id THEN
      RAISE EXCEPTION 'CROSS_ESTABLISHMENT_UNIT: final_unit_id % belongs to establishment %, not %',
        v_unit_id, v_unit_est, NEW.establishment_id;
    END IF;
  END IF;

  -- Check packagingLevels
  IF jsonb_typeof(NEW.conditionnement_config->'packagingLevels') = 'array' THEN
    FOR v_level IN SELECT * FROM jsonb_array_elements(NEW.conditionnement_config->'packagingLevels')
    LOOP
      -- type_unit_id
      v_unit_id := (v_level->>'type_unit_id')::uuid;
      IF v_unit_id IS NOT NULL THEN
        SELECT establishment_id INTO v_unit_est FROM measurement_units WHERE id = v_unit_id;
        IF v_unit_est IS DISTINCT FROM NEW.establishment_id THEN
          RAISE EXCEPTION 'CROSS_ESTABLISHMENT_UNIT: type_unit_id % belongs to establishment %, not %',
            v_unit_id, v_unit_est, NEW.establishment_id;
        END IF;
      END IF;

      -- contains_unit_id
      v_unit_id := (v_level->>'contains_unit_id')::uuid;
      IF v_unit_id IS NOT NULL THEN
        SELECT establishment_id INTO v_unit_est FROM measurement_units WHERE id = v_unit_id;
        IF v_unit_est IS DISTINCT FROM NEW.establishment_id THEN
          RAISE EXCEPTION 'CROSS_ESTABLISHMENT_UNIT: contains_unit_id % belongs to establishment %, not %',
            v_unit_id, v_unit_est, NEW.establishment_id;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- Also check top-level unit columns
CREATE OR REPLACE FUNCTION public.fn_validate_product_unit_columns_isolation()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
DECLARE
  v_col_name text;
  v_unit_id uuid;
  v_unit_est uuid;
BEGIN
  -- Check each unit column
  FOREACH v_col_name IN ARRAY ARRAY['final_unit_id','supplier_billing_unit_id','stock_handling_unit_id',
    'delivery_unit_id','kitchen_unit_id','price_display_unit_id','inventory_display_unit_id','min_stock_unit_id']
  LOOP
    EXECUTE format('SELECT ($1).%I', v_col_name) INTO v_unit_id USING NEW;
    IF v_unit_id IS NOT NULL THEN
      SELECT establishment_id INTO v_unit_est FROM measurement_units WHERE id = v_unit_id;
      IF v_unit_est IS DISTINCT FROM NEW.establishment_id THEN
        RAISE EXCEPTION 'CROSS_ESTABLISHMENT_UNIT: column % value % belongs to establishment %, not %',
          v_col_name, v_unit_id, v_unit_est, NEW.establishment_id;
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_products_v2_unit_isolation_config
  BEFORE INSERT OR UPDATE OF conditionnement_config ON public.products_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_product_unit_isolation();

CREATE TRIGGER trg_products_v2_unit_isolation_columns
  BEFORE INSERT OR UPDATE OF final_unit_id, supplier_billing_unit_id, stock_handling_unit_id,
    delivery_unit_id, kitchen_unit_id, price_display_unit_id, inventory_display_unit_id, min_stock_unit_id
  ON public.products_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_product_unit_columns_isolation();
