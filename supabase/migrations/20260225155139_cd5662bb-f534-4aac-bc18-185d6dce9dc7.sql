
CREATE OR REPLACE FUNCTION public.get_imported_supplier_products(
  p_client_establishment_id UUID,
  p_supplier_establishment_id UUID
)
RETURNS TABLE (
  id UUID,
  nom_produit TEXT,
  category TEXT,
  storage_zone_id UUID,
  storage_zone_name TEXT,
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
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify active partnership exists between supplier and client
  IF NOT EXISTS (
    SELECT 1 FROM supplier_clients sc
    WHERE sc.supplier_establishment_id = p_supplier_establishment_id
      AND sc.client_establishment_id = p_client_establishment_id
      AND sc.status = 'active'
  ) THEN
    RAISE EXCEPTION 'No active partnership';
  END IF;

  -- Resolve the supplier establishment's name to match against local invoice_suppliers
  -- The import flow creates an invoice_supplier with the external supplier's name
  RETURN QUERY
  SELECT
    p.id,
    p.nom_produit,
    p.category,
    p.storage_zone_id,
    sz.name AS storage_zone_name,
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
  FROM products_v2 p
  LEFT JOIN storage_zones sz ON sz.id = p.storage_zone_id
  INNER JOIN invoice_suppliers isup ON isup.id = p.supplier_id
  WHERE p.establishment_id = p_client_establishment_id
    AND p.archived_at IS NULL
    AND isup.name_normalized = (
      SELECT lower(trim(e.name)) FROM establishments e WHERE e.id = p_supplier_establishment_id
    )
  ORDER BY p.nom_produit;
END;
$$;
