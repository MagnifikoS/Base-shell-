-- PR-14 corrected: Drop old version and recreate with proper stock init, no EXCEPTION WHEN OTHERS

DROP FUNCTION IF EXISTS public.fn_create_product_complete(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID,
  JSONB, TEXT,
  UUID, UUID, UUID, UUID, UUID, UUID,
  NUMERIC, NUMERIC, NUMERIC,
  UUID, NUMERIC, UUID, NUMERIC, UUID,
  BOOLEAN, INTEGER,
  TEXT, UUID, JSONB,
  TEXT, UUID, JSONB,
  TEXT, UUID, JSONB
);

CREATE OR REPLACE FUNCTION public.fn_create_product_complete(
  -- Identité produit
  p_establishment_id UUID,
  p_user_id UUID,
  p_nom_produit TEXT,
  p_name_normalized TEXT,
  p_code_produit TEXT DEFAULT NULL,
  p_code_barres TEXT DEFAULT NULL,
  p_supplier_id UUID DEFAULT NULL,
  p_info_produit TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  -- Conditionnement
  p_conditionnement_config JSONB DEFAULT NULL,
  p_conditionnement_resume TEXT DEFAULT NULL,
  -- Unités
  p_final_unit_id UUID DEFAULT NULL,
  p_stock_handling_unit_id UUID DEFAULT NULL,
  p_delivery_unit_id UUID DEFAULT NULL,
  p_supplier_billing_unit_id UUID DEFAULT NULL,
  p_price_display_unit_id UUID DEFAULT NULL,
  p_kitchen_unit_id UUID DEFAULT NULL,
  -- Prix
  p_final_unit_price NUMERIC DEFAULT NULL,
  p_supplier_billing_quantity NUMERIC DEFAULT NULL,
  p_supplier_billing_line_total NUMERIC DEFAULT NULL,
  -- Stock
  p_storage_zone_id UUID DEFAULT NULL,
  p_min_stock_quantity_canonical NUMERIC DEFAULT NULL,
  p_min_stock_unit_id UUID DEFAULT NULL,
  p_initial_stock_quantity NUMERIC DEFAULT NULL,
  p_initial_stock_unit_id UUID DEFAULT NULL,
  -- Options
  p_allow_unit_sale BOOLEAN DEFAULT FALSE,
  p_dlc_warning_days INTEGER DEFAULT NULL,
  -- Input config (3 modes)
  p_purchase_mode TEXT DEFAULT 'integer',
  p_purchase_preferred_unit_id UUID DEFAULT NULL,
  p_purchase_unit_chain JSONB DEFAULT NULL,
  p_reception_mode TEXT DEFAULT 'integer',
  p_reception_preferred_unit_id UUID DEFAULT NULL,
  p_reception_unit_chain JSONB DEFAULT NULL,
  p_internal_mode TEXT DEFAULT 'integer',
  p_internal_preferred_unit_id UUID DEFAULT NULL,
  p_internal_unit_chain JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
  v_existing_id UUID;
  v_init_result JSONB;
BEGIN
  -- 1. Collision check (name_normalized + establishment)
  SELECT id INTO v_existing_id
  FROM products_v2
  WHERE establishment_id = p_establishment_id
    AND name_normalized = p_name_normalized
    AND archived_at IS NULL;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'COLLISION',
      'existing_id', v_existing_id
    );
  END IF;

  -- 2. INSERT produit (initial_stock_quantity persisted for audit trail)
  INSERT INTO products_v2 (
    establishment_id, created_by,
    nom_produit, name_normalized,
    code_produit, code_barres,
    supplier_id, info_produit, category_id,
    conditionnement_config, conditionnement_resume,
    final_unit_id, stock_handling_unit_id,
    delivery_unit_id, supplier_billing_unit_id,
    price_display_unit_id, kitchen_unit_id,
    final_unit_price,
    supplier_billing_quantity,
    supplier_billing_line_total,
    storage_zone_id,
    min_stock_quantity_canonical, min_stock_unit_id,
    initial_stock_quantity, initial_stock_unit_id,
    allow_unit_sale, dlc_warning_days
  ) VALUES (
    p_establishment_id, p_user_id,
    p_nom_produit, p_name_normalized,
    p_code_produit, p_code_barres,
    p_supplier_id, p_info_produit, p_category_id,
    p_conditionnement_config, p_conditionnement_resume,
    p_final_unit_id, p_stock_handling_unit_id,
    p_delivery_unit_id, p_supplier_billing_unit_id,
    p_price_display_unit_id, p_kitchen_unit_id,
    p_final_unit_price,
    p_supplier_billing_quantity,
    p_supplier_billing_line_total,
    p_storage_zone_id,
    p_min_stock_quantity_canonical, p_min_stock_unit_id,
    p_initial_stock_quantity, p_initial_stock_unit_id,
    p_allow_unit_sale, p_dlc_warning_days
  )
  RETURNING id INTO v_product_id;

  -- 3. INSERT product_input_config (atomique avec le produit)
  INSERT INTO product_input_config (
    product_id, establishment_id,
    purchase_mode, purchase_preferred_unit_id, purchase_unit_chain,
    reception_mode, reception_preferred_unit_id, reception_unit_chain,
    internal_mode, internal_preferred_unit_id, internal_unit_chain
  ) VALUES (
    v_product_id, p_establishment_id,
    p_purchase_mode, p_purchase_preferred_unit_id, p_purchase_unit_chain,
    p_reception_mode, p_reception_preferred_unit_id, p_reception_unit_chain,
    p_internal_mode, p_internal_preferred_unit_id, p_internal_unit_chain
  );

  -- 4. Initialize stock if initial quantity provided
  -- fn_initialize_product_stock(p_product_id, p_user_id, p_initial_quantity)
  -- reads storage_zone_id and stock_handling_unit_id from products_v2 internally
  IF COALESCE(p_initial_stock_quantity, 0) > 0
     AND p_storage_zone_id IS NOT NULL THEN
    v_init_result := fn_initialize_product_stock(
      v_product_id,
      p_user_id,
      p_initial_stock_quantity  -- CORRECTION #1: pass quantity explicitly
    );
    IF NOT COALESCE((v_init_result->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'STOCK_INIT_FAILED: %', v_init_result->>'error';
    END IF;
  END IF;

  -- 5. Success — no EXCEPTION WHEN OTHERS (CORRECTION #2)
  -- Real SQL errors propagate naturally to the caller
  RETURN jsonb_build_object(
    'ok', true,
    'product_id', v_product_id
  );
END;
$$;