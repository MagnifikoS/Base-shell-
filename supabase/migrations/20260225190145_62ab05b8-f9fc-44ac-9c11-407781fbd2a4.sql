CREATE OR REPLACE FUNCTION public.resolve_supplier_products_for_shipment(
  p_supplier_establishment_id UUID,
  p_client_product_ids UUID[]
)
RETURNS TABLE(
  client_product_id UUID,
  supplier_product_id UUID,
  supplier_product_name TEXT,
  supplier_storage_zone_id UUID,
  supplier_stock_handling_unit_id UUID,
  supplier_final_unit_id UUID,
  supplier_billing_unit_id UUID,
  supplier_conditionnement_config JSONB,
  matched_by TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Verify caller belongs to the supplier establishment
  IF NOT public.user_belongs_to_establishment(auth.uid(), p_supplier_establishment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: caller not in supplier establishment';
  END IF;

  RETURN QUERY
  WITH client_products AS (
    SELECT
      cp.id AS cp_id,
      cp.code_produit AS cp_code,
      cp.nom_produit AS cp_name
    FROM public.products_v2 cp
    WHERE cp.id = ANY(p_client_product_ids)
      AND cp.archived_at IS NULL
  ),
  supplier_products AS (
    SELECT
      sp.id AS sp_id,
      sp.code_produit AS sp_code,
      sp.nom_produit AS sp_name,
      sp.storage_zone_id,
      sp.stock_handling_unit_id,
      sp.final_unit_id,
      sp.supplier_billing_unit_id,
      sp.conditionnement_config
    FROM public.products_v2 sp
    WHERE sp.establishment_id = p_supplier_establishment_id
      AND sp.archived_at IS NULL
  ),
  code_matches AS (
    SELECT DISTINCT ON (cp.cp_id)
      cp.cp_id,
      sp.sp_id,
      sp.sp_name,
      sp.storage_zone_id,
      sp.stock_handling_unit_id,
      sp.final_unit_id,
      sp.supplier_billing_unit_id,
      sp.conditionnement_config,
      'code_produit'::TEXT AS matched_by
    FROM client_products cp
    JOIN supplier_products sp
      ON lower(trim(sp.sp_code)) = lower(trim(cp.cp_code))
    WHERE cp.cp_code IS NOT NULL
      AND cp.cp_code <> ''
      AND sp.sp_code IS NOT NULL
      AND sp.sp_code <> ''
    ORDER BY cp.cp_id, sp.sp_id
  ),
  name_matches AS (
    SELECT DISTINCT ON (cp.cp_id)
      cp.cp_id,
      sp.sp_id,
      sp.sp_name,
      sp.storage_zone_id,
      sp.stock_handling_unit_id,
      sp.final_unit_id,
      sp.supplier_billing_unit_id,
      sp.conditionnement_config,
      'nom_produit'::TEXT AS matched_by
    FROM client_products cp
    JOIN supplier_products sp
      ON lower(trim(sp.sp_name)) = lower(trim(cp.cp_name))
    WHERE NOT EXISTS (
      SELECT 1
      FROM code_matches cm
      WHERE cm.cp_id = cp.cp_id
    )
    ORDER BY cp.cp_id, sp.sp_id
  ),
  all_matches AS (
    SELECT
      cm.cp_id AS am_client_product_id,
      cm.sp_id AS am_supplier_product_id,
      cm.sp_name AS am_supplier_product_name,
      cm.storage_zone_id AS am_supplier_storage_zone_id,
      cm.stock_handling_unit_id AS am_supplier_stock_handling_unit_id,
      cm.final_unit_id AS am_supplier_final_unit_id,
      cm.supplier_billing_unit_id AS am_supplier_billing_unit_id,
      cm.conditionnement_config AS am_supplier_conditionnement_config,
      cm.matched_by AS am_matched_by
    FROM code_matches cm

    UNION ALL

    SELECT
      nm.cp_id AS am_client_product_id,
      nm.sp_id AS am_supplier_product_id,
      nm.sp_name AS am_supplier_product_name,
      nm.storage_zone_id AS am_supplier_storage_zone_id,
      nm.stock_handling_unit_id AS am_supplier_stock_handling_unit_id,
      nm.final_unit_id AS am_supplier_final_unit_id,
      nm.supplier_billing_unit_id AS am_supplier_billing_unit_id,
      nm.conditionnement_config AS am_supplier_conditionnement_config,
      nm.matched_by AS am_matched_by
    FROM name_matches nm
  )
  SELECT
    am.am_client_product_id,
    am.am_supplier_product_id,
    am.am_supplier_product_name,
    am.am_supplier_storage_zone_id,
    am.am_supplier_stock_handling_unit_id,
    am.am_supplier_final_unit_id,
    am.am_supplier_billing_unit_id,
    am.am_supplier_conditionnement_config,
    am.am_matched_by
  FROM all_matches am;
END;
$$;