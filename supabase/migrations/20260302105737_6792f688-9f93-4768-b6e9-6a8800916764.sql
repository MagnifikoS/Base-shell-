
-- Disable immutable triggers on stock_events
DROP TRIGGER IF EXISTS trg_stock_events_no_delete ON stock_events;
DROP TRIGGER IF EXISTS trg_stock_events_no_update ON stock_events;

-- Purge Magnifiko + Piccolo Magnifiko
DO $$
DECLARE
  v_est_ids uuid[] := ARRAY[
    'e9c3dccf-bee3-46c0-b068-52e05c18d883'::uuid,
    'c0129f18-dfe7-4cc5-bc4e-d00e9e1d977e'::uuid
  ];
  v_nb int; v_ne int; v_np int; v_nea int;
BEGIN
  SELECT count(*) INTO v_nb FROM products_v2 WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000';
  SELECT count(*) INTO v_ne FROM stock_events WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000';

  DELETE FROM bl_app_lines WHERE establishment_id = ANY(v_est_ids);
  DELETE FROM bl_app_files WHERE establishment_id = ANY(v_est_ids);
  DELETE FROM bl_app_documents WHERE establishment_id = ANY(v_est_ids);
  DELETE FROM brain_events WHERE establishment_id = ANY(v_est_ids);
  DELETE FROM brain_rules WHERE establishment_id = ANY(v_est_ids);
  DELETE FROM inventory_lines WHERE session_id IN (SELECT id FROM inventory_sessions WHERE establishment_id = ANY(v_est_ids));
  DELETE FROM stock_document_lines WHERE document_id IN (SELECT id FROM stock_documents WHERE establishment_id = ANY(v_est_ids));
  DELETE FROM stock_events WHERE establishment_id = ANY(v_est_ids);
  DELETE FROM zone_stock_snapshots WHERE storage_zone_id IN (SELECT id FROM storage_zones WHERE establishment_id = ANY(v_est_ids));
  DELETE FROM inventory_sessions WHERE establishment_id = ANY(v_est_ids);
  DELETE FROM stock_documents WHERE establishment_id = ANY(v_est_ids);
  DELETE FROM inventory_zone_products WHERE establishment_id = ANY(v_est_ids);
  DELETE FROM products_v2 WHERE establishment_id = ANY(v_est_ids);

  SELECT count(*) INTO v_np FROM products_v2 WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000';
  SELECT count(*) INTO v_nea FROM stock_events WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000';
  IF v_np != v_nb OR v_nea != v_ne THEN
    RAISE EXCEPTION 'SAFETY ABORT: Nonna Secret modified!';
  END IF;
END $$;

-- Re-enable immutable triggers
CREATE TRIGGER trg_stock_events_no_delete
  BEFORE DELETE ON stock_events
  FOR EACH ROW EXECUTE FUNCTION fn_stock_events_immutable();

CREATE TRIGGER trg_stock_events_no_update
  BEFORE UPDATE ON stock_events
  FOR EACH ROW EXECUTE FUNCTION fn_stock_events_immutable();
