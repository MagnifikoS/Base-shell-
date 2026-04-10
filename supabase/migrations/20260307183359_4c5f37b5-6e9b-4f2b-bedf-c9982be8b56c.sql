
-- ═══════════════════════════════════════════════════════════════════════════
-- UPSERT: fn_import_b2b_product_atomic now handles name collisions gracefully
-- If a product with the same (establishment_id, supplier_id, name_normalized)
-- already exists (active), update it instead of failing on unique constraint.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_import_b2b_product_atomic(
  p_establishment_id uuid, p_user_id uuid,
  p_nom_produit text, p_name_normalized text, p_code_produit text,
  p_category text, p_category_id uuid, p_supplier_id uuid,
  p_final_unit_id uuid, p_supplier_billing_unit_id uuid,
  p_delivery_unit_id uuid, p_stock_handling_unit_id uuid,
  p_kitchen_unit_id uuid, p_price_display_unit_id uuid,
  p_min_stock_unit_id uuid, p_final_unit_price numeric,
  p_conditionnement_config jsonb, p_conditionnement_resume text,
  p_min_stock_quantity_canonical numeric, p_storage_zone_id uuid,
  p_source_product_id uuid, p_source_establishment_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id UUID;
  v_existing_id UUID;
  v_init_result JSONB;
BEGIN
  -- 1. Verify caller belongs to establishment
  IF NOT EXISTS (
    SELECT 1 FROM get_user_establishment_ids() AS eid
    WHERE eid = p_establishment_id
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- 2. Clean orphaned tracking from previously deleted products
  DELETE FROM b2b_imported_products
  WHERE establishment_id = p_establishment_id
    AND source_product_id = p_source_product_id
    AND source_establishment_id = p_source_establishment_id;

  -- 3. Check for existing active product with same name+supplier (upsert)
  SELECT id INTO v_existing_id
  FROM products_v2
  WHERE establishment_id = p_establishment_id
    AND supplier_id = p_supplier_id
    AND name_normalized = p_name_normalized
    AND archived_at IS NULL
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- UPDATE existing product instead of failing
    UPDATE products_v2 SET
      nom_produit = p_nom_produit,
      code_produit = CASE WHEN p_code_produit = '' THEN code_produit ELSE p_code_produit END,
      category_id = COALESCE(p_category_id, category_id),
      final_unit_id = p_final_unit_id,
      supplier_billing_unit_id = p_supplier_billing_unit_id,
      delivery_unit_id = p_delivery_unit_id,
      stock_handling_unit_id = p_stock_handling_unit_id,
      kitchen_unit_id = p_kitchen_unit_id,
      price_display_unit_id = p_price_display_unit_id,
      min_stock_unit_id = p_min_stock_unit_id,
      final_unit_price = p_final_unit_price,
      conditionnement_config = p_conditionnement_config,
      conditionnement_resume = p_conditionnement_resume,
      storage_zone_id = COALESCE(p_storage_zone_id, storage_zone_id),
      updated_at = now()
    WHERE id = v_existing_id;

    v_product_id := v_existing_id;

    -- Ensure zone mapping exists
    INSERT INTO inventory_zone_products (
      establishment_id, product_id, storage_zone_id, display_order
    ) VALUES (
      p_establishment_id, v_product_id, p_storage_zone_id, 0
    ) ON CONFLICT DO NOTHING;

  ELSE
    -- INSERT new product
    INSERT INTO products_v2 (
      establishment_id, nom_produit, name_normalized,
      code_produit, category, category_id, supplier_id, final_unit_id,
      supplier_billing_unit_id, delivery_unit_id, stock_handling_unit_id,
      kitchen_unit_id, price_display_unit_id, min_stock_unit_id,
      final_unit_price, conditionnement_config, conditionnement_resume,
      min_stock_quantity_canonical, storage_zone_id,
      created_by
    ) VALUES (
      p_establishment_id, p_nom_produit, p_name_normalized,
      p_code_produit, p_category, p_category_id, p_supplier_id, p_final_unit_id,
      p_supplier_billing_unit_id, p_delivery_unit_id, p_stock_handling_unit_id,
      p_kitchen_unit_id, p_price_display_unit_id, p_min_stock_unit_id,
      p_final_unit_price, p_conditionnement_config, p_conditionnement_resume,
      p_min_stock_quantity_canonical, p_storage_zone_id,
      p_user_id
    ) RETURNING id INTO v_product_id;

    -- Inventory zone assignment
    INSERT INTO inventory_zone_products (
      establishment_id, product_id, storage_zone_id, display_order
    ) VALUES (
      p_establishment_id, v_product_id, p_storage_zone_id, 0
    );

    -- Initialize stock via centralized RPC
    v_init_result := fn_initialize_product_stock(v_product_id, p_user_id);
    IF NOT COALESCE((v_init_result->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'STOCK_INIT_FAILED: %', v_init_result->>'error';
    END IF;
  END IF;

  -- B2B tracking (always upsert)
  INSERT INTO b2b_imported_products (
    establishment_id, source_product_id, source_establishment_id,
    local_product_id, imported_by
  ) VALUES (
    p_establishment_id, p_source_product_id, p_source_establishment_id,
    v_product_id, p_user_id
  ) ON CONFLICT DO NOTHING;

  RETURN v_product_id;
END;
$function$;
