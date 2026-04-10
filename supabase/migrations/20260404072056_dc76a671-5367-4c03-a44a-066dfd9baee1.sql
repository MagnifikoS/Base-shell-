
-- 1. Update fn_save_product_wizard to accept and persist allow_unit_sale
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
  p_supplier_billing_line_total numeric DEFAULT NULL,
  p_allow_unit_sale boolean DEFAULT false
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
    allow_unit_sale = p_allow_unit_sale,
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
      'supplier_billing_quantity', 'supplier_billing_line_total', 'allow_unit_sale'
    )
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;


-- 2. Update fn_get_b2b_catalogue to include allow_unit_sale in product output
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
      p.price_display_unit_id,
      p.min_stock_unit_id,
      p.min_stock_quantity_canonical,
      p.allow_unit_sale
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
