
-- Fix stock_document_lines families for all existing tests
UPDATE stock_document_lines SET canonical_family = 'weight' WHERE canonical_family = 'mass';

-- Fix test 1: re-run RPC with correct family
DO $$
DECLARE v_result JSONB;
BEGIN
  v_result := fn_post_b2b_reception(
    'f0000001-ae50-b2b0-0001-000000000001'::uuid,
    'e9c3dccf-bee3-46c0-b068-52e05c18d883'::uuid,
    'f056aae1-acb3-4209-949a-a0b399854061'::uuid,
    '5eb12587-71fb-45df-b9e2-b5192124d612'::uuid,
    jsonb_build_array(
      jsonb_build_object('supplier_product_id','a0000001-0e50-b2b0-0000-000000000001','client_product_id','b0000001-0e50-b2b0-0000-000000000001','quantity_canonical',10,'supplier_canonical_unit_id','09a320f0-c826-4234-b1d9-a30fd87508cf','client_canonical_unit_id','0acf2a5f-5ea4-48c5-8fee-e91a587eab53','client_canonical_family','weight','product_name_snapshot','[TEST] TOMATE PELÉE','unit_price',2.50,'line_total',25.00),
      jsonb_build_object('supplier_product_id','a0000001-0e50-b2b0-0000-000000000002','client_product_id','b0000001-0e50-b2b0-0000-000000000002','quantity_canonical',5,'supplier_canonical_unit_id','09a320f0-c826-4234-b1d9-a30fd87508cf','client_canonical_unit_id','0acf2a5f-5ea4-48c5-8fee-e91a587eab53','client_canonical_family','weight','product_name_snapshot','[TEST] MOZZARELLA DI BUFALA','unit_price',15.00,'line_total',75.00),
      jsonb_build_object('supplier_product_id','a0000001-0e50-b2b0-0000-000000000003','client_product_id','b0000001-0e50-b2b0-0000-000000000003','quantity_canonical',3,'supplier_canonical_unit_id','5d959707-b7cd-4a0b-81cb-c1fbcb11ac29','client_canonical_unit_id','be5d064e-9860-45c6-9049-af88e77436c7','client_canonical_family','volume','product_name_snapshot','[TEST] HUILE OLIVE EXTRA VIERGE','unit_price',8.00,'line_total',24.00)
    )
  );
  INSERT INTO audit_logs (organization_id, action, target_type, target_id, metadata)
  VALUES ('f056aae1-acb3-4209-949a-a0b399854061', 'test1_result', 'test', 'f0000001-ae50-b2b0-0001-000000000001', v_result);
END;
$$;

-- Fix test 2: re-run RPC with correct family
DO $$
DECLARE v_result JSONB;
BEGIN
  v_result := fn_post_b2b_reception(
    'f0000002-ae50-b2b0-0002-000000000002'::uuid,
    'e9c3dccf-bee3-46c0-b068-52e05c18d883'::uuid,
    'f056aae1-acb3-4209-949a-a0b399854061'::uuid,
    '5eb12587-71fb-45df-b9e2-b5192124d612'::uuid,
    jsonb_build_array(
      jsonb_build_object('supplier_product_id','a0000001-0e50-b2b0-0000-000000000004','client_product_id','b0000001-0e50-b2b0-0000-000000000004','quantity_canonical',12,'supplier_canonical_unit_id','252649a4-3905-4e56-959e-f4735521fbf4','client_canonical_unit_id','100978f3-3e0d-437c-89ac-23d7a9fd6738','client_canonical_family','count','product_name_snapshot','[TEST] BASILIC FRAIS BOTTE','unit_price',1.50,'line_total',18.00)
    )
  );
  INSERT INTO audit_logs (organization_id, action, target_type, target_id, metadata)
  VALUES ('f056aae1-acb3-4209-949a-a0b399854061', 'test2_result', 'test', 'f0000002-ae50-b2b0-0002-000000000002', v_result);
END;
$$;
