DO $$
DECLARE
  v_order_ids uuid[] := ARRAY[
    'be79a9b7-6c66-4b7a-8d44-cd20fb8133e3','d486f6dc-86ea-4277-9fa4-a9d3cb845bb4',
    '5baac9f9-7a46-4d80-8a37-dde62450094b','06ffe2d0-68bb-4c83-b562-8a7feb330deb',
    'dd8e72fb-5de2-46f5-b55b-e05ac22e43bf','95473f3f-0453-49c1-a162-1129292e1044',
    'e6d4fe9e-e992-42f2-9011-f16e2e8efa2e','cd8507e1-f8b2-4fb2-acc1-b117b6b51e79',
    '84ae10f5-f852-483e-99b9-ecde2e87c77c','f3d7f1b7-c828-49ba-ad2b-1c2c31d9560f',
    'bcf026b9-e78e-4196-9b82-53d8e6e3db41','8f1bdac9-cfe5-4b15-83aa-809dfeabd093',
    '81bea062-aa0a-47cf-ac6b-beac870e8d31','6f7b0648-870f-4aa0-8017-2c48de50de8e',
    'd4244652-d065-4b59-bb0a-f0eefcfb4f2e','eae026b7-60ca-4e22-b46e-4881123eeef3'
  ];
  v_stock_doc_ids uuid[] := ARRAY[
    '84e98ada-6e5b-4c58-80df-8b8a5b2d11b8','b8f26211-b278-4e52-ad53-dcb623cc1663',
    '1ad3f9a8-cb3a-4aa9-a0ae-fe4e75cb3a05','f3e8fdaf-ed97-4da9-90ce-68a299d6486a',
    '3f947e8c-ad45-4bcc-a875-de69f95b56b2','583594d4-7413-46c0-97a1-fb3ab3956c57',
    '189ba762-6af0-4fcf-89bd-5313129be34c','7485b469-cb83-471b-9de2-17840637c34f',
    '1403a76e-9fd6-4ec1-bd63-a4bb811cad9d',
    'ad15988c-f789-4720-bc9b-8fd12abfd51e','97dffb3b-aa0e-4193-9c21-6829b8a0857d',
    '9fc83930-71a9-4283-95fa-f3c45da4ca8e','a9fe5fa0-befd-4a8e-b217-5df9f841754f',
    '8de9d0e6-83ad-43f6-baef-17cdc4cb6081','45a81e80-75b4-41fb-94e4-9b2e3b107989',
    'd5333ab3-c586-4a4c-b1a3-3e61e0e0e78b','731de5d0-ecca-4e8d-8288-b635697da2dc',
    'd9057665-cee8-4faa-b876-2d07f319af94',
    '00bb6209-488d-4b42-ae4c-15c311a10940','021b8a60-f55d-4a48-8a9c-c5227a6ee198'
  ];
  v_bl_retrait_ids uuid[] := ARRAY[
    '5ed2f8d2-a723-4357-b434-29d681c27b09','7c50537e-1047-4e23-8f1b-e0ef8ae3e5da',
    '55a7a136-da26-4680-93f0-134f76e42ce5','9dbef80a-a161-469c-b8fe-9f3d84eaa490',
    'dd1ae860-196f-40cb-a773-eb5f0bac7883','bf28a8ca-0eac-4de3-bf19-1bfc1f2866b8',
    '009549ca-20b0-49b0-a978-c0ac6eb32a0e','15565d1a-5440-402c-b38d-7a72ce38d86a',
    '646e9be7-1713-4c25-afc5-cf2725525e2e'
  ];
  v_bl_reception_ids uuid[] := ARRAY[
    'b1ca9744-9357-4bfc-a21a-d8638d39035f','cb8fe920-f12e-4bbd-99ce-05a21b076609',
    '6b0a10f0-ee7b-4958-90dc-4e4c6fd5fe8e','68a2c617-32cd-4b63-88fd-bc70936ccfff',
    '3efeb09a-5a95-4bdf-a361-0ab68d4fe160','b23bb3a2-0132-490b-a3bf-1529d8b9acbd',
    '6441885a-e9ad-41bc-b186-9015eb28b36a','27fe77cf-758a-4556-94df-e678d9899bab',
    '24d169e7-00e8-41a6-936d-da5aa07be270'
  ];
BEGIN
  -- 1. Disable immutable triggers on stock_events
  ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_delete;
  ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_update;

  -- 2. Delete stock events
  DELETE FROM stock_events WHERE document_id = ANY(v_stock_doc_ids);

  -- 3. Re-enable immutable triggers
  ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_delete;
  ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_update;

  -- 4. Delete stock document lines
  DELETE FROM stock_document_lines WHERE document_id = ANY(v_stock_doc_ids);

  -- 5. Delete BL withdrawal lines
  DELETE FROM bl_withdrawal_lines WHERE bl_withdrawal_document_id = ANY(v_bl_retrait_ids);

  -- 6. Delete BL app lines + files (reception)
  DELETE FROM bl_app_lines WHERE bl_app_document_id = ANY(v_bl_reception_ids);
  DELETE FROM bl_app_files WHERE bl_app_document_id = ANY(v_bl_reception_ids);

  -- 7. Unlink orders from BL docs
  UPDATE product_orders 
  SET bl_retrait_document_id = NULL, bl_reception_document_id = NULL
  WHERE id = ANY(v_order_ids);

  -- 8. Delete BL docs
  DELETE FROM bl_withdrawal_documents WHERE id = ANY(v_bl_retrait_ids);
  DELETE FROM bl_app_documents WHERE id = ANY(v_bl_reception_ids);

  -- 9. Delete correction stock docs first (FK to parent)
  DELETE FROM stock_documents WHERE id IN ('00bb6209-488d-4b42-ae4c-15c311a10940','021b8a60-f55d-4a48-8a9c-c5227a6ee198');
  DELETE FROM stock_documents WHERE id = ANY(v_stock_doc_ids);

  -- 10. Delete order lines + orders
  DELETE FROM product_order_lines WHERE order_id = ANY(v_order_ids);
  DELETE FROM product_orders WHERE id = ANY(v_order_ids);
END $$;