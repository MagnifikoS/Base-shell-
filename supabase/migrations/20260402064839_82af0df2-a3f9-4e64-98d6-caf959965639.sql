CREATE OR REPLACE FUNCTION public.fn_save_product_wizard(
  p_product_id uuid,
  p_user_id uuid,
  p_nom_produit text,
  p_name_normalized text,
  p_code_produit text,
  p_conditionnement_config jsonb,
  p_conditionnement_resume text,
  p_supplier_billing_unit_id uuid,
  p_final_unit_price numeric,
  p_final_unit_id uuid,
  p_delivery_unit_id uuid,
  p_price_display_unit_id uuid,
  p_stock_handling_unit_id uuid,
  p_kitchen_unit_id uuid,
  p_min_stock_quantity_canonical numeric,
  p_min_stock_unit_id uuid,
  p_category text,
  p_new_zone_id uuid,
  p_old_zone_id uuid,
  p_estimated_qty numeric DEFAULT 0,
  p_canonical_unit_id uuid DEFAULT NULL,
  p_canonical_family text DEFAULT NULL,
  p_context_hash text DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_dlc_warning_days integer DEFAULT NULL,
  p_supplier_billing_quantity numeric DEFAULT NULL,
  p_supplier_billing_line_total numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_zone_changed BOOLEAN;
  v_zone_result JSONB;
  v_transferred_qty NUMERIC := 0;
  v_resolved_category_id UUID;
  v_resolved_category_name TEXT;
BEGIN
  -- 1. Lock + fetch product
  SELECT * INTO v_product
  FROM products_v2
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;

  -- 2. Optimistic lock check
  IF p_expected_updated_at IS NOT NULL AND v_product.updated_at != p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OPTIMISTIC_LOCK_CONFLICT',
      'expected', p_expected_updated_at::text,
      'actual', v_product.updated_at::text);
  END IF;

  -- 2b. GUARD: stock_handling_unit_id change with existing stock
  IF v_product.stock_handling_unit_id IS NOT NULL
     AND p_stock_handling_unit_id IS NOT NULL
     AND v_product.stock_handling_unit_id != p_stock_handling_unit_id
     AND fn_product_has_stock(p_product_id)
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STOCK_UNIT_LOCKED',
      'message', 'Impossible de modifier l''unité stock : le produit a encore du stock.');
  END IF;

  -- 2c. Resolve dual-write: category_id takes priority
  IF p_category_id IS NOT NULL THEN
    v_resolved_category_id := p_category_id;
    SELECT name INTO v_resolved_category_name
    FROM product_categories WHERE id = p_category_id;
  ELSE
    v_resolved_category_name := p_category;
    SELECT id INTO v_resolved_category_id
    FROM product_categories
    WHERE establishment_id = v_product.establishment_id
      AND lower(trim(name)) = lower(trim(p_category))
      AND is_archived = false
    LIMIT 1;
  END IF;

  -- 3. Determine if zone changed
  v_zone_changed := (
    p_new_zone_id IS NOT NULL 
    AND p_old_zone_id IS NOT NULL 
    AND p_new_zone_id != p_old_zone_id
    AND p_new_zone_id != COALESCE(v_product.storage_zone_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

  -- 4. Update ALL product fields atomically
  UPDATE products_v2
  SET
    nom_produit = UPPER(TRIM(p_nom_produit)),
    name_normalized = p_name_normalized,
    code_produit = p_code_produit,
    conditionnement_config = p_conditionnement_config,
    conditionnement_resume = p_conditionnement_resume,
    supplier_billing_unit_id = p_supplier_billing_unit_id,
    final_unit_price = p_final_unit_price,
    final_unit_id = p_final_unit_id,
    delivery_unit_id = p_delivery_unit_id,
    price_display_unit_id = p_price_display_unit_id,
    stock_handling_unit_id = p_stock_handling_unit_id,
    kitchen_unit_id = p_kitchen_unit_id,
    min_stock_quantity_canonical = p_min_stock_quantity_canonical,
    min_stock_unit_id = p_min_stock_unit_id,
    category = v_resolved_category_name,
    category_id = v_resolved_category_id,
    dlc_warning_days = p_dlc_warning_days,
    supplier_billing_quantity = p_supplier_billing_quantity,
    supplier_billing_line_total = p_supplier_billing_line_total,
    storage_zone_id = CASE 
      WHEN v_zone_changed THEN v_product.storage_zone_id
      ELSE COALESCE(p_new_zone_id, v_product.storage_zone_id)
    END,
    updated_at = now()
  WHERE id = p_product_id;

  -- 5. Zone transfer via SSOT RPC (same transaction!)
  IF v_zone_changed THEN
    v_zone_result := fn_transfer_product_zone(
      p_product_id := p_product_id,
      p_new_zone_id := p_new_zone_id,
      p_user_id := p_user_id,
      p_estimated_qty := p_estimated_qty,
      p_canonical_unit_id := p_canonical_unit_id,
      p_canonical_family := p_canonical_family,
      p_context_hash := p_context_hash
    );

    IF NOT (v_zone_result->>'ok')::boolean THEN
      RAISE EXCEPTION 'ZONE_TRANSFER_FAILED: %', v_zone_result->>'error';
    END IF;

    v_transferred_qty := COALESCE((v_zone_result->>'transferred_qty')::numeric, 0);
  END IF;

  -- 6. Return structured result
  RETURN jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'zone_changed', v_zone_changed,
    'transferred_qty', v_transferred_qty,
    'category_id', v_resolved_category_id,
    'fields_applied', jsonb_build_array(
      'nom_produit', 'code_produit', 'conditionnement_config', 'conditionnement_resume',
      'supplier_billing_unit_id', 'final_unit_price', 'final_unit_id',
      'delivery_unit_id', 'price_display_unit_id', 'stock_handling_unit_id',
      'kitchen_unit_id', 'min_stock_quantity_canonical', 'min_stock_unit_id',
      'category', 'category_id', 'dlc_warning_days', 'storage_zone_id',
      'supplier_billing_quantity', 'supplier_billing_line_total'
    )
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;