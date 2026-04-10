
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
  v_product_category_id uuid;
  v_alerts_enabled boolean;
  v_category_name text;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF OLD.final_unit_price IS NOT DISTINCT FROM NEW.final_unit_price THEN
    RETURN NEW;
  END IF;

  IF NEW.final_unit_price IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    FOR rec IN
      SELECT
        bip.local_product_id,
        bip.establishment_id AS client_establishment_id,
        p_local.final_unit_price AS client_old_price,
        p_local.nom_produit AS product_name,
        p_local.category_id AS product_category_id
      FROM b2b_imported_products bip
      JOIN products_v2 p_local ON p_local.id = bip.local_product_id
      JOIN b2b_partnerships bp ON bp.supplier_establishment_id = bip.source_establishment_id
        AND bp.client_establishment_id = bip.establishment_id
        AND bp.status = 'active'
      WHERE bip.source_product_id = NEW.id
    LOOP
      UPDATE products_v2
      SET final_unit_price = NEW.final_unit_price
      WHERE id = rec.local_product_id;

      BEGIN
        SELECT enabled, global_threshold_pct, category_thresholds
        INTO v_alerts_enabled, v_global_threshold, v_cat_thresholds
        FROM price_alert_settings
        WHERE establishment_id = rec.client_establishment_id;

        IF NOT FOUND OR NOT v_alerts_enabled THEN
          CONTINUE;
        END IF;

        IF rec.client_old_price IS NULL OR rec.client_old_price = 0 THEN
          v_variation_pct := 100;
        ELSE
          v_variation_pct := ROUND(
            ((NEW.final_unit_price - rec.client_old_price) / rec.client_old_price) * 100,
            2
          );
        END IF;

        v_threshold := v_global_threshold;
        v_product_category_id := rec.product_category_id;
        IF v_product_category_id IS NOT NULL 
           AND v_cat_thresholds IS NOT NULL
           AND v_cat_thresholds ? (v_product_category_id::text) THEN
          v_threshold := (v_cat_thresholds ->> (v_product_category_id::text))::numeric;
        END IF;

        v_category_name := NULL;
        IF v_product_category_id IS NOT NULL THEN
          SELECT name INTO v_category_name FROM product_categories WHERE id = v_product_category_id;
        END IF;

        IF ABS(v_variation_pct) >= v_threshold THEN
          INSERT INTO price_alerts (
            establishment_id, product_id, source_product_id,
            supplier_name, product_name, category,
            old_price, new_price, variation_pct, day_date
          ) VALUES (
            rec.client_establishment_id, rec.local_product_id, NEW.id,
            COALESCE(NEW.nom_produit, ''), COALESCE(rec.product_name, ''),
            v_category_name,
            COALESCE(rec.client_old_price, 0), NEW.final_unit_price,
            v_variation_pct, CURRENT_DATE
          )
          ON CONFLICT (product_id, establishment_id, day_date)
          DO UPDATE SET
            old_price = EXCLUDED.old_price,
            new_price = EXCLUDED.new_price,
            variation_pct = EXCLUDED.variation_pct,
            supplier_name = EXCLUDED.supplier_name,
            seen_at = NULL,
            acked_at = NULL,
            updated_at = now();
        END IF;

      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[fn_sync_b2b_price] Alert creation skipped for product %: %', rec.local_product_id, SQLERRM;
      END;

    END LOOP;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[fn_sync_b2b_price] Sync skipped entirely: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;
