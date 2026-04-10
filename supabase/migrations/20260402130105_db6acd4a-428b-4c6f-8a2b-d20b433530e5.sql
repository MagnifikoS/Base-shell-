
-- ════════════════════════════════════════════════════════════
-- 1. UPDATE fn_get_b2b_catalogue: add billing fields to export
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_get_b2b_catalogue(
  p_partnership_id UUID,
  p_client_establishment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partnership b2b_partnerships%ROWTYPE;
  v_supplier_est_id UUID;
  v_products JSONB;
  v_units JSONB;
BEGIN
  -- 1. Verify caller belongs to client establishment
  IF NOT EXISTS (
    SELECT 1 FROM get_user_establishment_ids() AS eid
    WHERE eid = p_client_establishment_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  -- 2. Verify partnership exists and is active
  SELECT * INTO v_partnership
  FROM b2b_partnerships
  WHERE id = p_partnership_id
    AND client_establishment_id = p_client_establishment_id
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PARTNERSHIP_NOT_FOUND');
  END IF;

  v_supplier_est_id := v_partnership.supplier_establishment_id;

  -- 3. Build catalogue with mutualization awareness
  WITH coherent_groups AS (
    SELECT img.id AS group_id
    FROM inventory_mutualisation_groups img
    JOIN inventory_mutualisation_members imm ON imm.group_id = img.id
    JOIN products_v2 mp ON mp.id = imm.product_id
    LEFT JOIN measurement_units mu ON mu.id = mp.final_unit_id
    WHERE img.establishment_id = v_supplier_est_id
      AND img.is_active = true
    GROUP BY img.id
    HAVING COUNT(DISTINCT mu.category) <= 1
  ),
  product_group_info AS (
    SELECT
      imm.product_id,
      img.id AS group_id,
      img.carrier_product_id,
      img.display_name AS group_display_name,
      (imm.product_id = img.carrier_product_id) AS is_carrier,
      (cg.group_id IS NOT NULL) AS is_coherent
    FROM inventory_mutualisation_members imm
    JOIN inventory_mutualisation_groups img
      ON img.id = imm.group_id
      AND img.establishment_id = v_supplier_est_id
      AND img.is_active = true
    LEFT JOIN coherent_groups cg ON cg.group_id = img.id
  ),
  visible_products AS (
    SELECT p.id
    FROM products_v2 p
    LEFT JOIN product_group_info pgi ON pgi.product_id = p.id
    WHERE p.establishment_id = v_supplier_est_id
      AND p.archived_at IS NULL
      AND (
        pgi.product_id IS NULL
        OR (pgi.is_coherent AND pgi.is_carrier)
        OR (NOT pgi.is_coherent)
      )
  )
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
  INTO v_products
  FROM (
    SELECT
      p.id,
      CASE
        WHEN pgi.is_coherent AND pgi.is_carrier THEN COALESCE(pgi.group_display_name, p.nom_produit)
        ELSE p.nom_produit
      END AS nom_produit,
      p.code_produit,
      p.category_id,
      COALESCE(pc.name, p.category) AS category_name,
      p.final_unit_price,
      p.conditionnement_config,
      p.conditionnement_resume,
      p.final_unit_id,
      p.supplier_billing_unit_id,
      p.supplier_billing_quantity,
      p.supplier_billing_line_total,
      p.delivery_unit_id,
      p.stock_handling_unit_id,
      p.kitchen_unit_id,
      p.price_display_unit_id
    FROM products_v2 p
    INNER JOIN visible_products vp ON vp.id = p.id
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    LEFT JOIN product_group_info pgi ON pgi.product_id = p.id
    ORDER BY
      CASE
        WHEN pgi.is_coherent AND pgi.is_carrier THEN COALESCE(pgi.group_display_name, p.nom_produit)
        ELSE p.nom_produit
      END
  ) sub;

  -- 4. Get units used by supplier products
  SELECT COALESCE(jsonb_agg(row_to_json(u)::jsonb), '[]'::jsonb)
  INTO v_units
  FROM (
    SELECT DISTINCT mu.id, mu.name, mu.abbreviation, mu.family, mu.category, mu.is_reference, mu.aliases
    FROM measurement_units mu
    WHERE mu.establishment_id = v_supplier_est_id
      AND mu.is_active = true
  ) u;

  RETURN jsonb_build_object(
    'ok', true,
    'products', v_products,
    'supplier_units', v_units,
    'supplier_establishment_id', v_supplier_est_id
  );
END;
$$;


-- ════════════════════════════════════════════════════════════
-- 2. UPDATE fn_import_b2b_product_atomic: accept + persist billing fields
-- ════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.fn_import_b2b_product_atomic(UUID,UUID,TEXT,TEXT,TEXT,TEXT,UUID,UUID,UUID,UUID,UUID,UUID,UUID,UUID,UUID,NUMERIC,JSONB,TEXT,NUMERIC,UUID,UUID,UUID);

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
  -- NEW: billing metadata
  p_supplier_billing_quantity NUMERIC DEFAULT NULL,
  p_supplier_billing_line_total NUMERIC DEFAULT NULL
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

  -- STEP 0: MUTUALIZATION GATE
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

  -- 2. Clean orphaned tracking
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
    -- === UPDATE PATH ===
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
    -- === INSERT PATH ===
    INSERT INTO products_v2 (
      establishment_id, nom_produit, name_normalized,
      code_produit, category, category_id, supplier_id, final_unit_id,
      supplier_billing_unit_id, delivery_unit_id, stock_handling_unit_id,
      kitchen_unit_id, price_display_unit_id, min_stock_unit_id,
      final_unit_price, conditionnement_config, conditionnement_resume,
      min_stock_quantity_canonical, storage_zone_id,
      supplier_billing_quantity, supplier_billing_line_total,
      created_by
    ) VALUES (
      p_establishment_id, p_nom_produit, p_name_normalized,
      v_clean_code, p_category, p_category_id, p_supplier_id, p_final_unit_id,
      p_supplier_billing_unit_id, p_delivery_unit_id, v_effective_stock_unit,
      p_kitchen_unit_id, p_price_display_unit_id, p_min_stock_unit_id,
      p_final_unit_price, p_conditionnement_config, p_conditionnement_resume,
      p_min_stock_quantity_canonical, p_storage_zone_id,
      p_supplier_billing_quantity, p_supplier_billing_line_total,
      p_user_id
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

  -- 8. Track import
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


-- ════════════════════════════════════════════════════════════
-- 3. ADD UPDATE RLS policy on b2b_imported_products
-- ════════════════════════════════════════════════════════════

CREATE POLICY "Members can update unit_mapping on their imports"
ON public.b2b_imported_products
FOR UPDATE
TO authenticated
USING (
  establishment_id IN (SELECT get_user_establishment_ids())
)
WITH CHECK (
  establishment_id IN (SELECT get_user_establishment_ids())
);
