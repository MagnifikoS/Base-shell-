
-- Fix: allow re-import of previously deleted products by removing orphaned tracking
-- before inserting new tracking record.
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

  -- 3. INSERT product
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

  -- 4. Inventory zone snapshot
  INSERT INTO inventory_zone_products (
    establishment_id, product_id, storage_zone_id, display_order
  ) VALUES (
    p_establishment_id, v_product_id, p_storage_zone_id, 0
  );

  -- 5. B2B tracking
  INSERT INTO b2b_imported_products (
    establishment_id, source_product_id, source_establishment_id,
    local_product_id, imported_by
  ) VALUES (
    p_establishment_id, p_source_product_id, p_source_establishment_id,
    v_product_id, p_user_id
  );

  RETURN v_product_id;
END;
$function$;
