
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
      p.min_stock_quantity_canonical
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
