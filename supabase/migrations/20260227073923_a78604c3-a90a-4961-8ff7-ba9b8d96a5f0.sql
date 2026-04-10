
-- Direct RPC call for TEST 1 - debug
DO $$
DECLARE v_result JSONB;
BEGIN
  v_result := fn_post_b2b_reception(
    'f0000001-ae50-b2b0-0001-000000000001'::uuid,
    'e9c3dccf-bee3-46c0-b068-52e05c18d883'::uuid,
    'f056aae1-acb3-4209-949a-a0b399854061'::uuid,
    '5eb12587-71fb-45df-b9e2-b5192124d612'::uuid,
    jsonb_build_array(
      jsonb_build_object('supplier_product_id','a0000001-0e50-b2b0-0000-000000000001','client_product_id','b0000001-0e50-b2b0-0000-000000000001','quantity_canonical',10,'supplier_canonical_unit_id','09a320f0-c826-4234-b1d9-a30fd87508cf','client_canonical_unit_id','0acf2a5f-5ea4-48c5-8fee-e91a587eab53','client_canonical_family','mass','product_name_snapshot','[TEST] TOMATE PELÉE','unit_price',2.50,'line_total',25.00),
      jsonb_build_object('supplier_product_id','a0000001-0e50-b2b0-0000-000000000002','client_product_id','b0000001-0e50-b2b0-0000-000000000002','quantity_canonical',5,'supplier_canonical_unit_id','09a320f0-c826-4234-b1d9-a30fd87508cf','client_canonical_unit_id','0acf2a5f-5ea4-48c5-8fee-e91a587eab53','client_canonical_family','mass','product_name_snapshot','[TEST] MOZZARELLA DI BUFALA','unit_price',15.00,'line_total',75.00),
      jsonb_build_object('supplier_product_id','a0000001-0e50-b2b0-0000-000000000003','client_product_id','b0000001-0e50-b2b0-0000-000000000003','quantity_canonical',3,'supplier_canonical_unit_id','5d959707-b7cd-4a0b-81cb-c1fbcb11ac29','client_canonical_unit_id','be5d064e-9860-45c6-9049-af88e77436c7','client_canonical_family','volume','product_name_snapshot','[TEST] HUILE OLIVE EXTRA VIERGE','unit_price',8.00,'line_total',24.00)
    )
  );
  -- Write result to audit_logs for retrieval
  INSERT INTO audit_logs (organization_id, action, target_type, target_id, metadata)
  VALUES ('f056aae1-acb3-4209-949a-a0b399854061', 'test_rpc_result', 'test', 'f0000001-ae50-b2b0-0001-000000000001', v_result);
END;
$$;
