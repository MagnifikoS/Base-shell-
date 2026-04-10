
-- Fix: guard contre boucle infinie (trigger depth)
CREATE OR REPLACE FUNCTION public.fn_sync_b2b_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_variation_pct numeric;
  v_threshold numeric;
  v_cat_thresholds jsonb;
  v_global_threshold numeric;
  v_product_category text;
  v_alerts_enabled boolean;
BEGIN
  -- Guard: prevent infinite recursion when updating client copies
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Only fire when final_unit_price actually changes
  IF OLD.final_unit_price IS NOT DISTINCT FROM NEW.final_unit_price THEN
    RETURN NEW;
  END IF;

  -- Skip if price is null
  IF NEW.final_unit_price IS NULL THEN
    RETURN NEW;
  END IF;

  -- Loop over all client products linked via B2B mapping
  FOR rec IN
    SELECT
      bip.local_product_id,
      bip.establishment_id AS client_establishment_id,
      p_local.final_unit_price AS client_old_price,
      p_local.name AS product_name,
      p_local.category AS product_category
    FROM b2b_imported_products bip
    JOIN products_v2 p_local ON p_local.id = bip.local_product_id
    JOIN b2b_partnerships bp ON bp.supplier_establishment_id = bip.source_establishment_id
      AND bp.client_establishment_id = bip.establishment_id
      AND bp.status = 'active'
    WHERE bip.source_product_id = NEW.id
  LOOP
    -- 1) Sync price
    UPDATE products_v2
    SET final_unit_price = NEW.final_unit_price,
        updated_at = now()
    WHERE id = rec.local_product_id;

    -- 2) Check if alerts enabled
    SELECT enabled, global_threshold_pct, category_thresholds
    INTO v_alerts_enabled, v_global_threshold, v_cat_thresholds
    FROM price_alert_settings
    WHERE establishment_id = rec.client_establishment_id;

    IF NOT FOUND OR NOT v_alerts_enabled THEN
      CONTINUE;
    END IF;

    -- 3) Calculate variation
    IF rec.client_old_price IS NULL OR rec.client_old_price = 0 THEN
      v_variation_pct := 100;
    ELSE
      v_variation_pct := ROUND(
        ((NEW.final_unit_price - rec.client_old_price) / rec.client_old_price) * 100,
        2
      );
    END IF;

    -- 4) Determine threshold
    v_threshold := v_global_threshold;
    v_product_category := rec.product_category;
    IF v_product_category IS NOT NULL AND v_cat_thresholds ? v_product_category THEN
      v_threshold := (v_cat_thresholds ->> v_product_category)::numeric;
    END IF;

    -- 5) Create alert if threshold exceeded
    IF ABS(v_variation_pct) >= v_threshold THEN
      INSERT INTO price_alerts (
        establishment_id, product_id, source_product_id,
        supplier_name, product_name, category,
        old_price, new_price, variation_pct, day_date
      ) VALUES (
        rec.client_establishment_id, rec.local_product_id, NEW.id,
        COALESCE(NEW.name, ''), COALESCE(rec.product_name, ''),
        v_product_category,
        COALESCE(rec.client_old_price, 0), NEW.final_unit_price,
        v_variation_pct, CURRENT_DATE
      )
      ON CONFLICT (product_id, establishment_id, day_date)
      DO UPDATE SET
        old_price = EXCLUDED.old_price,
        new_price = EXCLUDED.new_price,
        variation_pct = EXCLUDED.variation_pct,
        supplier_name = EXCLUDED.supplier_name,
        updated_at = now();
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
