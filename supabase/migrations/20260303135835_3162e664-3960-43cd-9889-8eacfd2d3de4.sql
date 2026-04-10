
-- Fix: fn_import_b2b_product_atomic must auto-initialize stock at 0
-- This means: ensure zone_stock_snapshots exists + insert inventory_line qty=0

CREATE OR REPLACE FUNCTION public.fn_import_b2b_product_atomic(
  p_establishment_id UUID,
  p_user_id UUID,
  p_source_product_id UUID,
  p_source_establishment_id UUID,
  -- product fields
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
  p_storage_zone_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
  v_org_id UUID;
  v_snapshot_record RECORD;
  v_session_id UUID;
BEGIN
  -- 1. Verify caller belongs to establishment
  IF NOT EXISTS (
    SELECT 1 FROM get_user_establishment_ids() AS eid
    WHERE eid = p_establishment_id
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Get organization_id for the establishment
  SELECT organization_id INTO v_org_id
  FROM establishments WHERE id = p_establishment_id;

  -- 2. INSERT product
  INSERT INTO products_v2 (
    establishment_id, nom_produit, name_normalized,
    code_produit, category, category_id, supplier_id, final_unit_id,
    supplier_billing_unit_id, delivery_unit_id, stock_handling_unit_id,
    kitchen_unit_id, price_display_unit_id, min_stock_unit_id,
    final_unit_price, conditionnement_config, conditionnement_resume,
    min_stock_quantity_canonical, storage_zone_id,
    created_by
  ) VALUES (
    p_establishment_id, p_nom_produit, p_name_normalized,
    p_code_produit, p_category, p_category_id, p_supplier_id, p_final_unit_id,
    p_supplier_billing_unit_id, p_delivery_unit_id, p_stock_handling_unit_id,
    p_kitchen_unit_id, p_price_display_unit_id, p_min_stock_unit_id,
    p_final_unit_price, p_conditionnement_config, p_conditionnement_resume,
    p_min_stock_quantity_canonical, p_storage_zone_id,
    p_user_id
  ) RETURNING id INTO v_product_id;

  -- 3. Inventory zone assignment
  INSERT INTO inventory_zone_products (
    establishment_id, product_id, storage_zone_id, display_order
  ) VALUES (
    p_establishment_id, v_product_id, p_storage_zone_id, 0
  );

  -- 4. Auto-initialize stock at 0
  -- 4a. Ensure zone_stock_snapshots exists (create bootstrap session if needed)
  SELECT zss.id, zss.snapshot_version_id
  INTO v_snapshot_record
  FROM zone_stock_snapshots zss
  WHERE zss.establishment_id = p_establishment_id
    AND zss.storage_zone_id = p_storage_zone_id;

  IF v_snapshot_record IS NULL THEN
    -- Create a bootstrap inventory session for this zone
    INSERT INTO inventory_sessions (
      establishment_id, organization_id, storage_zone_id,
      started_by, status, total_products, counted_products,
      started_at, completed_at
    ) VALUES (
      p_establishment_id, v_org_id, p_storage_zone_id,
      p_user_id, 'termine', 0, 0,
      now(), now()
    ) RETURNING id INTO v_session_id;

    -- Create the zone_stock_snapshot pointing to this session
    INSERT INTO zone_stock_snapshots (
      establishment_id, storage_zone_id, snapshot_version_id
    ) VALUES (
      p_establishment_id, p_storage_zone_id, v_session_id
    );
  ELSE
    v_session_id := v_snapshot_record.snapshot_version_id;
  END IF;

  -- 4b. Insert inventory_line qty=0
  INSERT INTO inventory_lines (
    session_id, product_id, quantity, unit_id,
    counted_at, counted_by, created_via
  ) VALUES (
    v_session_id, v_product_id, 0, p_stock_handling_unit_id,
    now(), p_user_id, 'B2B_IMPORT'
  );

  -- 5. B2B tracking
  INSERT INTO b2b_imported_products (
    establishment_id, source_product_id, source_establishment_id,
    local_product_id, imported_by
  ) VALUES (
    p_establishment_id, p_source_product_id, p_source_establishment_id,
    v_product_id, p_user_id
  );

  RETURN v_product_id;
END;
$$;
