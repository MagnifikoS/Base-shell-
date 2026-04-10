
CREATE OR REPLACE FUNCTION public.fn_get_b2b_catalogue(p_partnership_id UUID, p_client_establishment_id UUID)
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

  -- 3. Get supplier products (non-archived only)
  -- category_name: prefer joined UUID category, fallback to legacy TEXT column
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
  INTO v_products
  FROM (
    SELECT
      p.id,
      p.nom_produit,
      p.code_produit,
      p.category_id,
      COALESCE(pc.name, p.category) AS category_name,
      p.final_unit_price,
      p.conditionnement_config,
      p.conditionnement_resume,
      p.final_unit_id,
      p.supplier_billing_unit_id,
      p.delivery_unit_id,
      p.stock_handling_unit_id,
      p.kitchen_unit_id,
      p.price_display_unit_id
    FROM products_v2 p
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    WHERE p.establishment_id = v_supplier_est_id
      AND p.archived_at IS NULL
    ORDER BY p.nom_produit
  ) sub;

  -- 4. Get units used by supplier products (for Phase B mapping)
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
