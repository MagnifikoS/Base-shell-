
-- TEST 2: LIVRAISON PARTIELLE (Basilic: demandé 20pce, livré 12pce)
DO $$
DECLARE
  v_order_id UUID := 'f0000002-ae50-b2b0-0002-000000000002';
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
    (v_order_id, 'b0000001-0e50-b2b0-0000-000000000004', '[TEST] BASILIC FRAIS BOTTE', 20, '100978f3-3e0d-437c-89ac-23d7a9fd6738', 'pce');

  UPDATE product_orders SET status = 'sent' WHERE id = v_order_id;
  UPDATE product_orders SET status = 'preparing' WHERE id = v_order_id;

  UPDATE product_order_lines SET prep_status = 'ok', quantity_prepared = 12,
    resolved_supplier_product_id = 'a0000001-0e50-b2b0-0000-000000000004'::UUID
  WHERE order_id = v_order_id;

  INSERT INTO stock_documents (establishment_id, organization_id, type, status, storage_zone_id, created_by, idempotency_key, lock_version)
  VALUES (v_nonna, v_nonna_org, 'WITHDRAWAL', 'DRAFT', '38b97f33-aff2-4a87-a0b4-034a0b182d94', v_nonna_user, 'b2b-withdrawal-' || v_order_id::text, 1)
  RETURNING id INTO v_stock_doc_id;

  INSERT INTO stock_document_lines (document_id, product_id, delta_quantity_canonical, canonical_unit_id, canonical_family, context_hash)
  VALUES (v_stock_doc_id, 'a0000001-0e50-b2b0-0000-000000000004', -12, '252649a4-3905-4e56-959e-f4735521fbf4', 'count', 'test-2');

  INSERT INTO bl_withdrawal_documents (establishment_id, organization_id, stock_document_id, destination_establishment_id, bl_number, bl_date, total_eur, created_by, destination_name)
  VALUES (v_nonna, v_nonna_org, v_stock_doc_id, v_magnifiko, 'BL-TEST-002', now()::date, 0, v_nonna_user, 'Magnifiko')
  RETURNING id INTO v_bl_retrait_id;

  UPDATE product_orders SET status = 'awaiting_client_validation', bl_retrait_document_id = v_bl_retrait_id, shipped_at = now() WHERE id = v_order_id;

  v_result := fn_post_b2b_reception(v_order_id, v_magnifiko, v_mag_org, v_mag_user,
    jsonb_build_array(
      jsonb_build_object('supplier_product_id','a0000001-0e50-b2b0-0000-000000000004','client_product_id','b0000001-0e50-b2b0-0000-000000000004','quantity_canonical',12,'supplier_canonical_unit_id','252649a4-3905-4e56-959e-f4735521fbf4','client_canonical_unit_id','100978f3-3e0d-437c-89ac-23d7a9fd6738','client_canonical_family','count','product_name_snapshot','[TEST] BASILIC FRAIS BOTTE','unit_price',1.50,'line_total',18.00)
    )
  );
  RAISE NOTICE 'TEST2: %', v_result;
END;
$$;
