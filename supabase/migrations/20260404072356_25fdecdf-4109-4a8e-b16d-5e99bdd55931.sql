
CREATE OR REPLACE FUNCTION public.fn_import_b2b_product_atomic(
  p_establishment_id UUID,
  p_user_id UUID,
  p_nom_produit TEXT,
  p_name_normalized TEXT,
  p_code_produit TEXT,
  p_category TEXT,
  p_category_id UUID,
  p_supplier_id UUID,
  p_final_unit_id UUID,
  p_supplier_billing_unit_id UUID,
  p_delivery_unit_id UUID,
  p_stock_handling_unit_id UUID,
  p_kitchen_unit_id UUID,
  p_price_display_unit_id UUID,
  p_min_stock_unit_id UUID,
  p_final_unit_price NUMERIC,
  p_conditionnement_config JSONB,
  p_conditionnement_resume TEXT,
  p_min_stock_quantity_canonical NUMERIC,
  p_storage_zone_id UUID,
  p_source_product_id UUID,
  p_source_establishment_id UUID,
  p_supplier_billing_quantity NUMERIC DEFAULT NULL,
  p_supplier_billing_line_total NUMERIC DEFAULT NULL,
  p_unit_mapping JSONB DEFAULT NULL,
  p_allow_unit_sale BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_product_id UUID;
  v_code_match_id UUID;
  v_name_match_id UUID;
  v_existing_id UUID;
  v_init_result JSONB;
  v_clean_code TEXT;
  v_effective_stock_unit UUID;
  v_effective_source_product_id UUID;
  v_carrier_id UUID;
  v_is_coherent BOOLEAN;
  v_group_id UUID;
BEGIN
  IF p_unit_mapping IS NULL OR p_unit_mapping = '{}'::JSONB THEN
    RAISE EXCEPTION 'IMPORT_INVALID:unit_mapping is required and must not be empty';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM get_user_establishment_ids() AS eid
    WHERE eid = p_establishment_id
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_effective_source_product_id := p_source_product_id;

  SELECT img.carrier_product_id, img.id
  INTO v_carrier_id, v_group_id
  FROM inventory_mutualisation_members imm
  JOIN inventory_mutualisation_groups img
    ON img.id = imm.group_id
    AND img.establishment_id = p_source_establishment_id
    AND img.is_active = true
  WHERE imm.product_id = p_source_product_id
  LIMIT 1;

  IF v_group_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT mu.category) <= 1
    INTO v_is_coherent
    FROM inventory_mutualisation_members imm2
    JOIN products_v2 mp ON mp.id = imm2.product_id
    LEFT JOIN measurement_units mu ON mu.id = mp.final_unit_id
    WHERE imm2.group_id = v_group_id;

    IF v_is_coherent THEN
      v_effective_source_product_id := v_carrier_id;
    END IF;
  END IF;

  v_effective_stock_unit := COALESCE(p_stock_handling_unit_id, p_final_unit_id);

  DELETE FROM b2b_imported_products
  WHERE establishment_id = p_establishment_id
    AND source_product_id = v_effective_source_product_id
    AND source_establishment_id = p_source_establishment_id;

  v_clean_code := NULLIF(TRIM(COALESCE(p_code_produit, '')), '');
  IF v_clean_code IS NOT NULL AND lower(v_clean_code) = 'null' THEN
    v_clean_code := NULL;
  END IF;

  IF v_clean_code IS NOT NULL THEN
    SELECT id INTO v_code_match_id
    FROM products_v2
    WHERE establishment_id = p_establishment_id
      AND code_produit = v_clean_code
      AND archived_at IS NULL
    LIMIT 1;
  END IF;

  SELECT id INTO v_name_match_id
  FROM products_v2
  WHERE establishment_id = p_establishment_id
    AND supplier_id = p_supplier_id
    AND name_normalized = p_name_normalized
    AND archived_at IS NULL
  LIMIT 1;

  IF v_code_match_id IS NOT NULL 
     AND v_name_match_id IS NOT NULL 
     AND v_code_match_id != v_name_match_id THEN
    RAISE EXCEPTION 'AMBIGUOUS_IDENTITY:code=% matches product %, but name=% matches product %',
      v_clean_code, v_code_match_id, p_name_normalized, v_name_match_id;
  END IF;

  v_existing_id := COALESCE(v_code_match_id, v_name_match_id);

  IF v_existing_id IS NOT NULL THEN
    UPDATE products_v2 SET
      nom_produit = p_nom_produit,
      name_normalized = p_name_normalized,
      code_produit = COALESCE(v_clean_code, code_produit),
      category_id = COALESCE(p_category_id, category_id),
      final_unit_id = p_final_unit_id,
      supplier_billing_unit_id = p_supplier_billing_unit_id,
      delivery_unit_id = p_delivery_unit_id,
      stock_handling_unit_id = v_effective_stock_unit,
      kitchen_unit_id = p_kitchen_unit_id,
      price_display_unit_id = p_price_display_unit_id,
      min_stock_unit_id = p_min_stock_unit_id,
      final_unit_price = p_final_unit_price,
      conditionnement_config = p_conditionnement_config,
      conditionnement_resume = p_conditionnement_resume,
      supplier_billing_quantity = p_supplier_billing_quantity,
      supplier_billing_line_total = p_supplier_billing_line_total,
      allow_unit_sale = p_allow_unit_sale,
      storage_zone_id = COALESCE(p_storage_zone_id, storage_zone_id),
      updated_at = now()
    WHERE id = v_existing_id;

    v_product_id := v_existing_id;

    INSERT INTO inventory_zone_products (
      establishment_id, product_id, storage_zone_id, display_order
    ) VALUES (
      p_establishment_id, v_product_id, p_storage_zone_id, 0
    ) ON CONFLICT DO NOTHING;

    v_init_result := fn_initialize_product_stock(v_product_id, p_user_id, 0);
    IF NOT COALESCE((v_init_result ->> 'ok')::BOOLEAN, false) THEN
      RAISE EXCEPTION 'STOCK_INIT_FAILED:%', COALESCE(v_init_result ->> 'error', 'unknown');
    END IF;

  ELSE
    INSERT INTO products_v2 (
      establishment_id, nom_produit, name_normalized,
      code_produit, category, category_id, supplier_id, final_unit_id,
      supplier_billing_unit_id, delivery_unit_id, stock_handling_unit_id,
      kitchen_unit_id, price_display_unit_id, min_stock_unit_id,
      final_unit_price, conditionnement_config, conditionnement_resume,
      min_stock_quantity_canonical, storage_zone_id,
      supplier_billing_quantity, supplier_billing_line_total,
      allow_unit_sale, created_by
    ) VALUES (
      p_establishment_id, p_nom_produit, p_name_normalized,
      v_clean_code, p_category, p_category_id, p_supplier_id, p_final_unit_id,
      p_supplier_billing_unit_id, p_delivery_unit_id, v_effective_stock_unit,
      p_kitchen_unit_id, p_price_display_unit_id, p_min_stock_unit_id,
      p_final_unit_price, p_conditionnement_config, p_conditionnement_resume,
      p_min_stock_quantity_canonical, p_storage_zone_id,
      p_supplier_billing_quantity, p_supplier_billing_line_total,
      p_allow_unit_sale, p_user_id
    ) RETURNING id INTO v_product_id;

    INSERT INTO inventory_zone_products (
      establishment_id, product_id, storage_zone_id, display_order
    ) VALUES (
      p_establishment_id, v_product_id, p_storage_zone_id, 0
    ) ON CONFLICT DO NOTHING;

    v_init_result := fn_initialize_product_stock(v_product_id, p_user_id, 0);
    IF NOT COALESCE((v_init_result ->> 'ok')::BOOLEAN, false) THEN
      RAISE EXCEPTION 'STOCK_INIT_FAILED:%', COALESCE(v_init_result ->> 'error', 'unknown');
    END IF;
  END IF;

  INSERT INTO b2b_imported_products (
    establishment_id, source_product_id, source_establishment_id,
    local_product_id, imported_by, unit_mapping
  ) VALUES (
    p_establishment_id, v_effective_source_product_id, p_source_establishment_id,
    v_product_id, p_user_id, p_unit_mapping
  );

  RETURN v_product_id;
END;
$$;
