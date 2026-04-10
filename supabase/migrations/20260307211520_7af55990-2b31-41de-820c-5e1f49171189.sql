
-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: fn_import_b2b_product_atomic — P1 code_produit + P2 name + ambiguity
-- 
-- Matching priority:
--   P1: code_produit (cross-supplier, if non-null/non-empty)
--   P2: supplier_id + name_normalized (scoped)
--   Ambiguous: P1 matches product A, P2 matches product B → RAISE
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
  v_code_match_id UUID;
  v_name_match_id UUID;
  v_existing_id UUID;
  v_init_result JSONB;
  v_clean_code TEXT;
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

  -- 3. Normalize code_produit (same logic as trigger, belt+suspenders)
  v_clean_code := NULLIF(TRIM(COALESCE(p_code_produit, '')), '');
  IF v_clean_code IS NOT NULL AND lower(v_clean_code) = 'null' THEN
    v_clean_code := NULL;
  END IF;

  -- 4. P1: Match by code_produit (cross-supplier, unique per establishment)
  IF v_clean_code IS NOT NULL THEN
    SELECT id INTO v_code_match_id
    FROM products_v2
    WHERE establishment_id = p_establishment_id
      AND code_produit = v_clean_code
      AND archived_at IS NULL
    LIMIT 1;
  END IF;

  -- 5. P2: Match by supplier_id + name_normalized
  SELECT id INTO v_name_match_id
  FROM products_v2
  WHERE establishment_id = p_establishment_id
    AND supplier_id = p_supplier_id
    AND name_normalized = p_name_normalized
    AND archived_at IS NULL
  LIMIT 1;

  -- 6. Ambiguity check: P1 and P2 match DIFFERENT products
  IF v_code_match_id IS NOT NULL 
     AND v_name_match_id IS NOT NULL 
     AND v_code_match_id != v_name_match_id THEN
    RAISE EXCEPTION 'AMBIGUOUS_IDENTITY:code=% matches product %, but name=% matches product %',
      v_clean_code, v_code_match_id, p_name_normalized, v_name_match_id;
  END IF;

  -- 7. Resolve: P1 wins, then P2, then INSERT
  v_existing_id := COALESCE(v_code_match_id, v_name_match_id);

  IF v_existing_id IS NOT NULL THEN
    -- UPDATE existing product
    UPDATE products_v2 SET
      nom_produit = p_nom_produit,
      name_normalized = p_name_normalized,
      code_produit = COALESCE(v_clean_code, code_produit),
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
    -- INSERT new product (trigger will normalize code_produit)
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
      v_clean_code, p_category, p_category_id, p_supplier_id, p_final_unit_id,
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
