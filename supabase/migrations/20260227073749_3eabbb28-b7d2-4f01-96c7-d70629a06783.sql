
-- TEST 1: FLUX NOMINAL COMPLET
DO $$
DECLARE
  v_order_id UUID := 'f0000001-ae50-b2b0-0001-000000000001';
  v_magnifiko UUID := 'e9c3dccf-bee3-46c0-b068-52e05c18d883';
  v_nonna UUID := '7775d89d-9977-4b1b-bf0c-1b2efe486000';
  v_mag_org UUID := 'f056aae1-acb3-4209-949a-a0b399854061';
  v_nonna_org UUID := '3e4bf632-974d-47ef-bd82-636901b9f7f4';
  v_nonna_user UUID := '52a9aeec-8bff-4760-848f-2764f983508b';
  v_mag_user UUID := '5eb12587-71fb-45df-b9e2-b5192124d612';
  v_bl_retrait_id UUID;
  v_stock_doc_id UUID;
  v_result JSONB;
BEGIN
  INSERT INTO product_orders (id, organization_id, source_establishment_id, destination_establishment_id, status, created_by, source_name_snapshot, destination_name_snapshot)
  VALUES (v_order_id, v_mag_org, v_magnifiko, v_nonna, 'draft', v_mag_user, 'Magnifiko', 'NONNA SECRET');

  INSERT INTO product_order_lines (order_id, product_id, product_name_snapshot, quantity_requested, canonical_unit_id, unit_label) VALUES
    (v_order_id, 'b0000001-0e50-b2b0-0000-000000000001', '[TEST] TOMATE PELÉE', 10, '0acf2a5f-5ea4-48c5-8fee-e91a587eab53', 'kg'),
    (v_order_id, 'b0000001-0e50-b2b0-0000-000000000002', '[TEST] MOZZARELLA DI BUFALA', 5, '0acf2a5f-5ea4-48c5-8fee-e91a587eab53', 'kg'),
    (v_order_id, 'b0000001-0e50-b2b0-0000-000000000003', '[TEST] HUILE OLIVE EXTRA VIERGE', 3, 'be5d064e-9860-45c6-9049-af88e77436c7', 'L');

  UPDATE product_orders SET status = 'sent' WHERE id = v_order_id;
  UPDATE product_orders SET status = 'preparing' WHERE id = v_order_id;

  UPDATE product_order_lines SET 
    prep_status = 'ok', quantity_prepared = quantity_requested,
    resolved_supplier_product_id = CASE 
      WHEN product_id = 'b0000001-0e50-b2b0-0000-000000000001' THEN 'a0000001-0e50-b2b0-0000-000000000001'::UUID
      WHEN product_id = 'b0000001-0e50-b2b0-0000-000000000002' THEN 'a0000001-0e50-b2b0-0000-000000000002'::UUID
      WHEN product_id = 'b0000001-0e50-b2b0-0000-000000000003' THEN 'a0000001-0e50-b2b0-0000-000000000003'::UUID
    END
  WHERE order_id = v_order_id;

  INSERT INTO stock_documents (establishment_id, organization_id, type, status, storage_zone_id, created_by, idempotency_key, lock_version)
  VALUES (v_nonna, v_nonna_org, 'WITHDRAWAL', 'DRAFT', 'dcfd334b-0b2e-4839-a8ae-b34cbd4efd7e', v_nonna_user, 'b2b-withdrawal-' || v_order_id::text, 1)
  RETURNING id INTO v_stock_doc_id;

  INSERT INTO stock_document_lines (document_id, product_id, delta_quantity_canonical, canonical_unit_id, canonical_family, context_hash) VALUES
    (v_stock_doc_id, 'a0000001-0e50-b2b0-0000-000000000001', -10, '09a320f0-c826-4234-b1d9-a30fd87508cf', 'mass', 'test-1'),
    (v_stock_doc_id, 'a0000001-0e50-b2b0-0000-000000000002', -5, '09a320f0-c826-4234-b1d9-a30fd87508cf', 'mass', 'test-1'),
    (v_stock_doc_id, 'a0000001-0e50-b2b0-0000-000000000003', -3, '5d959707-b7cd-4a0b-81cb-c1fbcb11ac29', 'volume', 'test-1');

  INSERT INTO bl_withdrawal_documents (establishment_id, organization_id, stock_document_id, destination_establishment_id, bl_number, bl_date, total_eur, created_by, destination_name)
  VALUES (v_nonna, v_nonna_org, v_stock_doc_id, v_magnifiko, 'BL-TEST-001', now()::date, 0, v_nonna_user, 'Magnifiko')
  RETURNING id INTO v_bl_retrait_id;

  UPDATE product_orders SET status = 'awaiting_client_validation', bl_retrait_document_id = v_bl_retrait_id, shipped_at = now() WHERE id = v_order_id;

  v_result := fn_post_b2b_reception(v_order_id, v_magnifiko, v_mag_org, v_mag_user,
    jsonb_build_array(
      jsonb_build_object('supplier_product_id','a0000001-0e50-b2b0-0000-000000000001','client_product_id','b0000001-0e50-b2b0-0000-000000000001','quantity_canonical',10,'supplier_canonical_unit_id','09a320f0-c826-4234-b1d9-a30fd87508cf','client_canonical_unit_id','0acf2a5f-5ea4-48c5-8fee-e91a587eab53','client_canonical_family','mass','product_name_snapshot','[TEST] TOMATE PELÉE','unit_price',2.50,'line_total',25.00),
      jsonb_build_object('supplier_product_id','a0000001-0e50-b2b0-0000-000000000002','client_product_id','b0000001-0e50-b2b0-0000-000000000002','quantity_canonical',5,'supplier_canonical_unit_id','09a320f0-c826-4234-b1d9-a30fd87508cf','client_canonical_unit_id','0acf2a5f-5ea4-48c5-8fee-e91a587eab53','client_canonical_family','mass','product_name_snapshot','[TEST] MOZZARELLA DI BUFALA','unit_price',15.00,'line_total',75.00),
      jsonb_build_object('supplier_product_id','a0000001-0e50-b2b0-0000-000000000003','client_product_id','b0000001-0e50-b2b0-0000-000000000003','quantity_canonical',3,'supplier_canonical_unit_id','5d959707-b7cd-4a0b-81cb-c1fbcb11ac29','client_canonical_unit_id','be5d064e-9860-45c6-9049-af88e77436c7','client_canonical_family','volume','product_name_snapshot','[TEST] HUILE OLIVE EXTRA VIERGE','unit_price',8.00,'line_total',24.00)
    )
  );
  RAISE NOTICE 'TEST1 RESULT: %', v_result;
END;
$$;
