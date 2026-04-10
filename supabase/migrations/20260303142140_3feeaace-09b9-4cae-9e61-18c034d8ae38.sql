
-- Drop the DUPLICATE signature (oid 78532) — the one with reordered params
-- The original (oid 78530) has the standard param order matching our RPC call
DROP FUNCTION IF EXISTS public.fn_import_b2b_product_atomic(
  p_establishment_id uuid,
  p_user_id uuid,
  p_source_product_id uuid,
  p_source_establishment_id uuid,
  p_nom_produit text,
  p_name_normalized text,
  p_code_produit text,
  p_category text,
  p_category_id uuid,
  p_supplier_id uuid,
  p_final_unit_id uuid,
  p_supplier_billing_unit_id uuid,
  p_delivery_unit_id uuid,
  p_stock_handling_unit_id uuid,
  p_kitchen_unit_id uuid,
  p_price_display_unit_id uuid,
  p_min_stock_unit_id uuid,
  p_final_unit_price numeric,
  p_conditionnement_config jsonb,
  p_conditionnement_resume text,
  p_min_stock_quantity_canonical numeric,
  p_storage_zone_id uuid
);
