
DO $$
DECLARE
  v_count INT;
  v_eids UUID[] := ARRAY[
    'e9c3dccf-bee3-46c0-b068-52e05c18d883'::UUID,
    '7775d89d-9977-4b1b-bf0c-1b2efe486000'::UUID
  ];
BEGIN
  SELECT count(*) INTO v_count FROM products_v2
  WHERE establishment_id = ANY(v_eids) AND nom_produit LIKE 'TEST%';
  IF v_count <> 22 THEN
    RAISE EXCEPTION 'SAFETY ABORT: expected 22, found %', v_count;
  END IF;

  CREATE TEMP TABLE _tp AS
  SELECT id FROM products_v2 WHERE establishment_id = ANY(v_eids) AND nom_produit LIKE 'TEST%';

  CREATE TEMP TABLE _tc AS
  SELECT DISTINCT cl.commande_id FROM commande_lines cl
  WHERE cl.product_id IN (SELECT id FROM _tp)
  AND NOT EXISTS (
    SELECT 1 FROM commande_lines cl2
    WHERE cl2.commande_id = cl.commande_id AND cl2.product_id NOT IN (SELECT id FROM _tp)
  );

  CREATE TEMP TABLE _tcl AS
  SELECT id FROM commande_lines WHERE commande_id IN (SELECT commande_id FROM _tc);

  CREATE TEMP TABLE _tsd AS
  SELECT DISTINCT sdl.document_id FROM stock_document_lines sdl
  WHERE sdl.product_id IN (SELECT id FROM _tp)
  AND NOT EXISTS (
    SELECT 1 FROM stock_document_lines sdl2
    WHERE sdl2.document_id = sdl.document_id AND sdl2.product_id NOT IN (SELECT id FROM _tp)
  );

  CREATE TEMP TABLE _tbl AS
  SELECT DISTINCT bal.bl_app_document_id FROM bl_app_lines bal
  WHERE bal.product_id IN (SELECT id FROM _tp)
  AND NOT EXISTS (
    SELECT 1 FROM bl_app_lines bal2
    WHERE bal2.bl_app_document_id = bal.bl_app_document_id AND bal2.product_id NOT IN (SELECT id FROM _tp)
  );

  -- 1. Litiges
  DELETE FROM litige_lines WHERE commande_line_id IN (SELECT id FROM _tcl);
  DELETE FROM litiges WHERE commande_id IN (SELECT commande_id FROM _tc);

  -- 2. Invoices
  DELETE FROM app_invoice_lines WHERE app_invoice_id IN (
    SELECT id FROM app_invoices WHERE commande_id IN (SELECT commande_id FROM _tc)
  );
  DELETE FROM app_invoices WHERE commande_id IN (SELECT commande_id FROM _tc);

  -- 3. Reception DLC
  DELETE FROM reception_lot_dlc WHERE commande_line_id IN (SELECT id FROM _tcl);

  -- 4. Stock events
  ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_delete;
  ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_update;
  DELETE FROM stock_events WHERE product_id IN (SELECT id FROM _tp);
  ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_delete;
  ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_update;

  -- 5. Stock document lines
  DELETE FROM stock_document_lines WHERE document_id IN (SELECT document_id FROM _tsd);

  -- 6. BL app
  DELETE FROM bl_app_files WHERE bl_app_document_id IN (SELECT bl_app_document_id FROM _tbl);
  DELETE FROM bl_app_lines WHERE bl_app_document_id IN (SELECT bl_app_document_id FROM _tbl);
  DELETE FROM bl_app_documents WHERE id IN (SELECT bl_app_document_id FROM _tbl);

  -- 7. Stock documents
  UPDATE stock_documents SET corrects_document_id = NULL
  WHERE id IN (SELECT document_id FROM _tsd) AND corrects_document_id IS NOT NULL;
  DELETE FROM stock_documents WHERE id IN (SELECT document_id FROM _tsd);

  -- 8. Commandes
  DELETE FROM commande_lines WHERE commande_id IN (SELECT commande_id FROM _tc);
  DELETE FROM commandes WHERE id IN (SELECT commande_id FROM _tc);

  -- 9. Inventory
  DELETE FROM inventory_lines WHERE product_id IN (SELECT id FROM _tp);
  DELETE FROM inventory_zone_products WHERE product_id IN (SELECT id FROM _tp);

  -- 10. Config & imports
  DELETE FROM product_input_config WHERE product_id IN (SELECT id FROM _tp);
  DELETE FROM b2b_imported_products
  WHERE local_product_id IN (SELECT id FROM _tp) OR source_product_id IN (SELECT id FROM _tp);

  -- 11. Products
  DELETE FROM products_v2 WHERE id IN (SELECT id FROM _tp);

  DROP TABLE _tp; DROP TABLE _tc; DROP TABLE _tcl; DROP TABLE _tsd; DROP TABLE _tbl;
END $$;
