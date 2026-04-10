
CREATE OR REPLACE FUNCTION public.export_products_csv()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
SELECT string_agg(csv_line, E'\n' ORDER BY rn)
FROM (
  SELECT 0 as rn, 'id,code_produit,code_barres,nom_produit,nom_produit_fr,name_normalized,category,variant_format,info_produit,supplier_name,supplier_id,storage_zone_name,storage_zone_id,final_unit_price,final_unit,final_unit_id,final_unit_abbr,supplier_billing_unit,supplier_billing_unit_id,billing_unit_abbr,stock_handling_unit_id,stock_unit_abbr,delivery_unit_id,delivery_unit_abbr,kitchen_unit_id,kitchen_unit_abbr,price_display_unit_id,price_display_unit_abbr,inventory_display_unit_id,inv_display_unit_abbr,min_stock_quantity_canonical,min_stock_unit_id,min_stock_unit_abbr,conditionnement_resume,conditionnement_config_json' as csv_line
  UNION ALL
  SELECT row_number() OVER (ORDER BY p.nom_produit) as rn,
    concat_ws(',',
      '"' || COALESCE(p.id::text,'') || '"',
      '"' || COALESCE(p.code_produit,'') || '"',
      '"' || COALESCE(p.code_barres,'') || '"',
      '"' || REPLACE(COALESCE(p.nom_produit,''),'"','""') || '"',
      '"' || REPLACE(COALESCE(p.nom_produit_fr,''),'"','""') || '"',
      '"' || REPLACE(COALESCE(p.name_normalized,''),'"','""') || '"',
      '"' || COALESCE(p.category,'') || '"',
      '"' || COALESCE(p.variant_format,'') || '"',
      '"' || REPLACE(COALESCE(p.info_produit,''),'"','""') || '"',
      '"' || REPLACE(COALESCE(s.name,''),'"','""') || '"',
      '"' || COALESCE(p.supplier_id::text,'') || '"',
      '"' || REPLACE(COALESCE(sz.name,''),'"','""') || '"',
      '"' || COALESCE(p.storage_zone_id::text,'') || '"',
      '"' || COALESCE(p.final_unit_price::text,'') || '"',
      '"' || COALESCE(mu_final.name,'') || '"',
      '"' || COALESCE(p.final_unit_id::text,'') || '"',
      '"' || COALESCE(mu_final.abbreviation,'') || '"',
      '"' || COALESCE(mu_billing.name,'') || '"',
      '"' || COALESCE(p.supplier_billing_unit_id::text,'') || '"',
      '"' || COALESCE(mu_billing.abbreviation,'') || '"',
      '"' || COALESCE(p.stock_handling_unit_id::text,'') || '"',
      '"' || COALESCE(mu_stock.abbreviation,'') || '"',
      '"' || COALESCE(p.delivery_unit_id::text,'') || '"',
      '"' || COALESCE(mu_delivery.abbreviation,'') || '"',
      '"' || COALESCE(p.kitchen_unit_id::text,'') || '"',
      '"' || COALESCE(mu_kitchen.abbreviation,'') || '"',
      '"' || COALESCE(p.price_display_unit_id::text,'') || '"',
      '"' || COALESCE(mu_price.abbreviation,'') || '"',
      '"' || COALESCE(p.inventory_display_unit_id::text,'') || '"',
      '"' || COALESCE(mu_inv.abbreviation,'') || '"',
      '"' || COALESCE(p.min_stock_quantity_canonical::text,'') || '"',
      '"' || COALESCE(p.min_stock_unit_id::text,'') || '"',
      '"' || COALESCE(mu_min.abbreviation,'') || '"',
      '"' || REPLACE(COALESCE(p.conditionnement_resume,''),'"','""') || '"',
      '"' || REPLACE(COALESCE(p.conditionnement_config::text,''),'"','""') || '"'
    ) as csv_line
  FROM products_v2 p
  LEFT JOIN invoice_suppliers s ON p.supplier_id = s.id
  LEFT JOIN storage_zones sz ON p.storage_zone_id = sz.id
  LEFT JOIN measurement_units mu_final ON p.final_unit_id = mu_final.id
  LEFT JOIN measurement_units mu_billing ON p.supplier_billing_unit_id = mu_billing.id
  LEFT JOIN measurement_units mu_stock ON p.stock_handling_unit_id = mu_stock.id
  LEFT JOIN measurement_units mu_delivery ON p.delivery_unit_id = mu_delivery.id
  LEFT JOIN measurement_units mu_kitchen ON p.kitchen_unit_id = mu_kitchen.id
  LEFT JOIN measurement_units mu_price ON p.price_display_unit_id = mu_price.id
  LEFT JOIN measurement_units mu_inv ON p.inventory_display_unit_id = mu_inv.id
  LEFT JOIN measurement_units mu_min ON p.min_stock_unit_id = mu_min.id
  WHERE p.archived_at IS NULL
) sub;
$$;
