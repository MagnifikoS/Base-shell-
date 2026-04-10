
DROP FUNCTION IF EXISTS public.get_cross_org_catalog_products(uuid, uuid);

CREATE FUNCTION public.get_cross_org_catalog_products(
  p_supplier_establishment_id UUID,
  p_client_establishment_id UUID
)
RETURNS TABLE(
  id UUID,
  nom_produit TEXT,
  category TEXT,
  storage_zone_id UUID,
  stock_handling_unit_id UUID,
  final_unit_id UUID,
  delivery_unit_id UUID,
  supplier_billing_unit_id UUID,
  conditionnement_config JSONB,
  code_produit TEXT,
  final_unit_price NUMERIC,
  info_produit TEXT,
  supplier_billing_unit TEXT,
  final_unit TEXT,
  conditionnement_resume TEXT,
  kitchen_unit_id UUID,
  price_display_unit_id UUID,
  min_stock_quantity_canonical NUMERIC,
  min_stock_unit_id UUID,
  code_barres TEXT
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    p.code_barres
  FROM supplier_client_catalog_items sci
  JOIN products_v2 p ON p.id = sci.product_id
  WHERE sci.supplier_establishment_id = p_supplier_establishment_id
    AND sci.client_establishment_id = p_client_establishment_id
    AND p.archived_at IS NULL
  ORDER BY p.nom_produit;
END;
$$;
