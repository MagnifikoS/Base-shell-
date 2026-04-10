-- Enrich cross-org catalog RPC with supplier storage zone name for clean client-side remapping
DROP FUNCTION IF EXISTS public.get_cross_org_catalog_products(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_cross_org_catalog_products(
  p_supplier_establishment_id uuid,
  p_client_establishment_id uuid
)
RETURNS TABLE(
  id uuid,
  nom_produit text,
  category text,
  storage_zone_id uuid,
  stock_handling_unit_id uuid,
  final_unit_id uuid,
  delivery_unit_id uuid,
  supplier_billing_unit_id uuid,
  conditionnement_config jsonb,
  code_produit text,
  final_unit_price numeric,
  info_produit text,
  supplier_billing_unit text,
  final_unit text,
  conditionnement_resume text,
  kitchen_unit_id uuid,
  price_display_unit_id uuid,
  min_stock_quantity_canonical numeric,
  min_stock_unit_id uuid,
  code_barres text,
  storage_zone_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_belongs_to_establishment(auth.uid(), p_client_establishment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: caller not in client establishment';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM supplier_clients
    WHERE supplier_establishment_id = p_supplier_establishment_id
      AND client_establishment_id = p_client_establishment_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'NO_ACTIVE_RELATIONSHIP';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.nom_produit,
    p.category,
    p.storage_zone_id,
    p.stock_handling_unit_id,
    p.final_unit_id,
    p.delivery_unit_id,
    p.supplier_billing_unit_id,
    p.conditionnement_config,
    p.code_produit,
    p.final_unit_price,
    p.info_produit,
    p.supplier_billing_unit,
    p.final_unit,
    p.conditionnement_resume,
    p.kitchen_unit_id,
    p.price_display_unit_id,
    p.min_stock_quantity_canonical,
    p.min_stock_unit_id,
    p.code_barres,
    sz.name
  FROM supplier_client_catalog_items sci
  JOIN products_v2 p ON p.id = sci.product_id
  LEFT JOIN storage_zones sz ON sz.id = p.storage_zone_id
  WHERE sci.supplier_establishment_id = p_supplier_establishment_id
    AND sci.client_establishment_id = p_client_establishment_id
    AND p.archived_at IS NULL
  ORDER BY p.nom_produit;
END;
$function$;