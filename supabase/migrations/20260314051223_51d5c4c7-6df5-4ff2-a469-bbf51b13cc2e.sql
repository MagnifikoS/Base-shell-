
DO $$
DECLARE
  v_id uuid := '9ac57795-0724-42a1-a555-f4b3bcbb2f22';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM establishments 
    WHERE id = v_id AND organization_id = 'f056aae1-acb3-4209-949a-a0b399854061' AND status = 'archived'
  ) THEN
    RAISE EXCEPTION 'SAFETY ABORT';
  END IF;

  -- BRAIN
  DELETE FROM brain_events WHERE establishment_id = v_id;
  DELETE FROM brain_rules WHERE establishment_id = v_id;

  -- STOCK EVENTS
  ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_delete;
  ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_update;
  DELETE FROM stock_events WHERE establishment_id = v_id;
  ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_delete;
  ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_update;

  -- ZONE STOCK SNAPSHOTS
  DELETE FROM zone_stock_snapshots WHERE snapshot_version_id IN (SELECT id FROM inventory_sessions WHERE establishment_id = v_id);
  DELETE FROM zone_stock_snapshots WHERE storage_zone_id IN (SELECT id FROM storage_zones WHERE establishment_id = v_id);

  -- INVENTORY
  DELETE FROM inventory_zone_products WHERE storage_zone_id IN (SELECT id FROM storage_zones WHERE establishment_id = v_id);
  DELETE FROM inventory_lines WHERE session_id IN (SELECT id FROM inventory_sessions WHERE establishment_id = v_id);
  DELETE FROM inventory_sessions WHERE establishment_id = v_id;

  -- STOCK DOCUMENTS
  DELETE FROM stock_document_lines WHERE document_id IN (SELECT id FROM stock_documents WHERE establishment_id = v_id);
  DELETE FROM purchase_line_items WHERE product_id IN (SELECT id FROM products_v2 WHERE establishment_id = v_id);

  -- BL
  DELETE FROM bl_app_lines WHERE establishment_id = v_id;
  DELETE FROM bl_app_files WHERE establishment_id = v_id;
  DELETE FROM bl_app_documents WHERE establishment_id = v_id;
  DELETE FROM bl_withdrawal_lines WHERE bl_withdrawal_document_id IN (SELECT id FROM bl_withdrawal_documents WHERE establishment_id = v_id);
  DELETE FROM bl_withdrawal_documents WHERE establishment_id = v_id;
  -- Nullify destination references from OTHER establishments
  UPDATE bl_withdrawal_documents SET destination_establishment_id = NULL WHERE destination_establishment_id = v_id;
  DELETE FROM stock_documents WHERE establishment_id = v_id;

  -- PAY
  DELETE FROM pay_allocations WHERE payment_id IN (SELECT id FROM pay_payments WHERE supplier_id IN (SELECT id FROM invoice_suppliers WHERE establishment_id = v_id));
  DELETE FROM pay_allocations WHERE pay_invoice_id IN (SELECT id FROM pay_invoices WHERE supplier_id IN (SELECT id FROM invoice_suppliers WHERE establishment_id = v_id));
  DELETE FROM pay_schedule_items WHERE supplier_id IN (SELECT id FROM invoice_suppliers WHERE establishment_id = v_id);
  DELETE FROM pay_schedule_items WHERE pay_invoice_id IN (SELECT id FROM pay_invoices WHERE supplier_id IN (SELECT id FROM invoice_suppliers WHERE establishment_id = v_id));
  DELETE FROM pay_payments WHERE supplier_id IN (SELECT id FROM invoice_suppliers WHERE establishment_id = v_id);
  DELETE FROM pay_supplier_rules WHERE supplier_id IN (SELECT id FROM invoice_suppliers WHERE establishment_id = v_id);
  DELETE FROM pay_invoices WHERE supplier_id IN (SELECT id FROM invoice_suppliers WHERE establishment_id = v_id);
  DELETE FROM pay_establishment_settings WHERE establishment_id = v_id;

  -- INVOICES
  DELETE FROM invoice_monthly_statements WHERE supplier_id IN (SELECT id FROM invoice_suppliers WHERE establishment_id = v_id);
  DELETE FROM invoices WHERE supplier_id IN (SELECT id FROM invoice_suppliers WHERE establishment_id = v_id);

  -- NOTIFICATIONS
  DELETE FROM notification_delivery_logs WHERE establishment_id = v_id;
  DELETE FROM notification_events WHERE establishment_id = v_id;
  DELETE FROM notification_incidents WHERE establishment_id = v_id;
  DELETE FROM notification_rules WHERE establishment_id = v_id;

  -- MEP
  DELETE FROM mep_order_lines WHERE order_id IN (SELECT id FROM mep_orders WHERE establishment_id = v_id OR source_establishment_id = v_id OR destination_establishment_id = v_id);
  DELETE FROM mep_orders WHERE establishment_id = v_id OR source_establishment_id = v_id OR destination_establishment_id = v_id;

  -- PRODUCTS & SUPPLIERS
  DELETE FROM products_v2 WHERE establishment_id = v_id;
  DELETE FROM products WHERE establishment_id = v_id;
  DELETE FROM invoice_suppliers WHERE establishment_id = v_id;
  DELETE FROM product_categories WHERE establishment_id = v_id;

  -- UNITS
  DELETE FROM unit_conversions WHERE establishment_id = v_id;
  DELETE FROM packaging_formats WHERE establishment_id = v_id;
  DELETE FROM measurement_units WHERE establishment_id = v_id;

  -- STORAGE ZONES
  DELETE FROM establishment_stock_settings WHERE establishment_id = v_id;
  ALTER TABLE storage_zones DISABLE TRIGGER trg_storage_zones_no_delete;
  DELETE FROM storage_zones WHERE establishment_id = v_id;
  ALTER TABLE storage_zones ENABLE TRIGGER trg_storage_zones_no_delete;

  -- PLANNING & BADGES
  DELETE FROM badge_events WHERE establishment_id = v_id;
  DELETE FROM planning_shifts WHERE establishment_id = v_id;
  DELETE FROM planning_weeks WHERE establishment_id = v_id;

  -- USER ASSOCIATIONS
  DELETE FROM user_roles WHERE establishment_id = v_id;
  DELETE FROM user_establishments WHERE establishment_id = v_id;
  DELETE FROM user_teams WHERE establishment_id = v_id;
  DELETE FROM invitations WHERE establishment_id = v_id;

  -- SETTINGS
  DELETE FROM extraction_settings WHERE establishment_id = v_id;
  DELETE FROM establishment_nav_config WHERE establishment_id = v_id;
  DELETE FROM establishment_role_nav_config WHERE establishment_id = v_id;
  DELETE FROM establishment_opening_hours WHERE establishment_id = v_id;
  DELETE FROM establishment_day_parts WHERE establishment_id = v_id;
  DELETE FROM badgeuse_settings WHERE establishment_id = v_id;
  DELETE FROM dlc_alert_settings WHERE establishment_id = v_id;

  -- FINAL
  DELETE FROM establishment_profiles WHERE establishment_id = v_id;
  DELETE FROM establishments WHERE id = v_id;
END;
$$;
