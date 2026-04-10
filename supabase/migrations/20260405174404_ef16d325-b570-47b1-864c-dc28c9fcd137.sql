
DO $$
DECLARE
  v_estab_id uuid := 'e9c3dccf-bee3-46c0-b068-52e05c18d883';
BEGIN
  ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_delete;
  ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_update;
  ALTER TABLE stock_events DISABLE TRIGGER trg_guard_stock_event_unit_ownership;

  DELETE FROM app_invoice_lines WHERE app_invoice_id IN (
    SELECT id FROM app_invoices WHERE client_establishment_id = v_estab_id
  );
  DELETE FROM app_invoices WHERE client_establishment_id = v_estab_id;

  DELETE FROM bl_app_lines WHERE establishment_id = v_estab_id;
  DELETE FROM bl_app_files WHERE establishment_id = v_estab_id;
  DELETE FROM bl_app_documents WHERE establishment_id = v_estab_id;

  DELETE FROM bl_withdrawal_lines WHERE bl_withdrawal_document_id IN (
    SELECT id FROM bl_withdrawal_documents WHERE establishment_id = v_estab_id
  );
  DELETE FROM bl_withdrawal_documents WHERE establishment_id = v_estab_id;

  DELETE FROM stock_events WHERE establishment_id = v_estab_id;
  DELETE FROM stock_document_lines WHERE document_id IN (
    SELECT id FROM stock_documents WHERE establishment_id = v_estab_id
  );
  UPDATE stock_document_lines SET source_line_id = NULL
  WHERE source_line_id IN (
    SELECT cl.id FROM commande_lines cl
    JOIN commandes c ON c.id = cl.commande_id
    WHERE c.client_establishment_id = v_estab_id
  );
  DELETE FROM stock_documents WHERE establishment_id = v_estab_id;
  DELETE FROM zone_stock_snapshots WHERE establishment_id = v_estab_id;

  DELETE FROM litige_lines WHERE commande_line_id IN (
    SELECT cl.id FROM commande_lines cl
    JOIN commandes c ON c.id = cl.commande_id
    WHERE c.client_establishment_id = v_estab_id
  );

  DELETE FROM commande_lines WHERE commande_id IN (
    SELECT id FROM commandes WHERE client_establishment_id = v_estab_id
  );
  DELETE FROM commandes WHERE client_establishment_id = v_estab_id;

  DELETE FROM inventory_lines WHERE session_id IN (
    SELECT id FROM inventory_sessions WHERE establishment_id = v_estab_id
  );
  DELETE FROM inventory_sessions WHERE establishment_id = v_estab_id;

  DELETE FROM inventory_discrepancies WHERE establishment_id = v_estab_id;
  DELETE FROM inventory_mutualisation_groups WHERE establishment_id = v_estab_id;
  DELETE FROM inventory_mutualisation_dismissed WHERE establishment_id = v_estab_id;
  DELETE FROM b2b_imported_products WHERE establishment_id = v_estab_id;
  DELETE FROM product_input_config WHERE establishment_id = v_estab_id;
  DELETE FROM inventory_zone_products WHERE product_id IN (
    SELECT id FROM products_v2 WHERE establishment_id = v_estab_id
  );
  DELETE FROM products_v2 WHERE establishment_id = v_estab_id;

  ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_delete;
  ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_update;
  ALTER TABLE stock_events ENABLE TRIGGER trg_guard_stock_event_unit_ownership;
END;
$$;
