
-- ═══════════════════════════════════════════════════════════════════════
-- FIX: fn_import_b2b_product_atomic — DISTINCT not supported in window functions
--
-- PostgreSQL does not support COUNT(DISTINCT x) OVER (...).
-- Replace with a separate query to check group coherence.
-- Logic is strictly identical: a group is coherent if all members
-- share the same measurement_units.category for their final_unit_id.
-- ═══════════════════════════════════════════════════════════════════════

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
  p_source_establishment_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  -- 1. Verify caller belongs to establishment
  IF NOT EXISTS (
    SELECT 1 FROM get_user_establishment_ids() AS eid
    WHERE eid = p_establishment_id
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- STEP 0: MUTUALIZATION GATE — redirect member → carrier
  -- Split into 2 queries to avoid unsupported DISTINCT in window fn
  -- ══════════════════════════════════════════════════════════════
  v_effective_source_product_id := p_source_product_id;

  -- Step 0a: Find the carrier and group for this source product
  SELECT img.carrier_product_id, img.id
  INTO v_carrier_id, v_group_id
  FROM inventory_mutualisation_members imm
  JOIN inventory_mutualisation_groups img
    ON img.id = imm.group_id
    AND img.establishment_id = p_source_establishment_id
    AND img.is_active = true
  WHERE imm.product_id = p_source_product_id
  LIMIT 1;

  -- Step 0b: If in a group, check coherence separately (no window function)
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
  -- No group or incoherent group: keep original source_product_id

  -- C4: Ensure stock_handling_unit_id is never null when final_unit_id is available
  v_effective_stock_unit := COALESCE(p_stock_handling_unit_id, p_final_unit_id);

  -- 2. Clean orphaned tracking from previously deleted products
  DELETE FROM b2b_imported_products
  WHERE establishment_id = p_establishment_id
    AND source_product_id = v_effective_source_product_id
    AND source_establishment_id = p_source_establishment_id;

  -- 3. Normalize code_produit
  v_clean_code := NULLIF(TRIM(COALESCE(p_code_produit, '')), '');
  IF v_clean_code IS NOT NULL AND lower(v_clean_code) = 'null' THEN
    v_clean_code := NULL;
  END IF;

  -- 4. P1: Match by code_produit
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

  -- 6. Ambiguity check
  IF v_code_match_id IS NOT NULL 
     AND v_name_match_id IS NOT NULL 
     AND v_code_match_id != v_name_match_id THEN
    RAISE EXCEPTION 'AMBIGUOUS_IDENTITY:code=% matches product %, but name=% matches product %',
      v_clean_code, v_code_match_id, p_name_normalized, v_name_match_id;
  END IF;

  -- 7. Resolve: P1 wins, then P2, then INSERT
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
      storage_zone_id = COALESCE(p_storage_zone_id, storage_zone_id),
      updated_at = now()
    WHERE id = v_existing_id;

    v_product_id := v_existing_id;

    INSERT INTO inventory_zone_products (
      establishment_id, product_id, storage_zone_id, display_order
    ) VALUES (
      p_establishment_id, v_product_id, p_storage_zone_id, 0
    ) ON CONFLICT DO NOTHING;

    -- C3 FIX: Initialize stock for existing products too
    v_init_result := fn_initialize_product_stock(v_product_id, p_user_id, 0);

  ELSE
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
      p_supplier_billing_unit_id, p_delivery_unit_id, v_effective_stock_unit,
      p_kitchen_unit_id, p_price_display_unit_id, p_min_stock_unit_id,
      p_final_unit_price, p_conditionnement_config, p_conditionnement_resume,
      p_min_stock_quantity_canonical, p_storage_zone_id,
      p_user_id
    ) RETURNING id INTO v_product_id;

    INSERT INTO inventory_zone_products (
      establishment_id, product_id, storage_zone_id, display_order
    ) VALUES (
      p_establishment_id, v_product_id, p_storage_zone_id, 0
    ) ON CONFLICT DO NOTHING;

    v_init_result := fn_initialize_product_stock(v_product_id, p_user_id, 0);
    IF (v_init_result ->> 'success')::BOOLEAN IS NOT TRUE THEN
      RAISE EXCEPTION 'STOCK_INIT_FAILED:%', v_init_result ->> 'error';
    END IF;
  END IF;

  -- 8. Track import (with effective source_product_id = carrier if mutualized)
  INSERT INTO b2b_imported_products (
    establishment_id, source_product_id, source_establishment_id,
    local_product_id, imported_by
  ) VALUES (
    p_establishment_id, v_effective_source_product_id, p_source_establishment_id,
    v_product_id, p_user_id
  );

  RETURN v_product_id;
END;
$$;

COMMENT ON FUNCTION fn_import_b2b_product_atomic IS
'Import atomique B2B avec garde-fou de mutualisation. '
'Si le source_product_id est un membre d''un groupe cohérent, '
'il est automatiquement redirigé vers le carrier_product_id. '
'Groupes incohérents: import normal sans redirection.';
