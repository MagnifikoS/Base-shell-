
-- ═══════════════════════════════════════════════════════════════════════════
-- PURGE B2B: Drop all B2B triggers, functions, views, tables, columns
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Drop B2B triggers
DROP TRIGGER IF EXISTS trg_b2b_mapping_guard ON product_order_lines;
DROP TRIGGER IF EXISTS trg_validate_b2b_status ON invoices;
DROP TRIGGER IF EXISTS trg_b2b_invoice_number ON invoices;
DROP TRIGGER IF EXISTS trg_b2b_close_guard ON product_orders;
DROP TRIGGER IF EXISTS trg_b2b_status_transition_guard ON product_orders;
DROP TRIGGER IF EXISTS trg_b2b_line_deletion_guard ON product_order_lines;

-- 2. Drop B2B views
DROP VIEW IF EXISTS v_b2b_coherence_triangulation CASCADE;
DROP VIEW IF EXISTS v_b2b_coherence_reconciliation CASCADE;
DROP VIEW IF EXISTS v_b2b_coherence_vat_orphans CASCADE;

-- 3. Drop B2B table
DROP TABLE IF EXISTS b2b_invoice_lines CASCADE;

-- 4. Drop B2B functions (with explicit signatures for overloaded ones)
DROP FUNCTION IF EXISTS fn_post_b2b_reception(uuid, uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS fn_post_b2b_reception(uuid, uuid, uuid, uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS fn_cancel_b2b_shipment CASCADE;
DROP FUNCTION IF EXISTS fn_is_cross_org_order CASCADE;
DROP FUNCTION IF EXISTS fn_assign_b2b_invoice_number CASCADE;
DROP FUNCTION IF EXISTS fn_validate_b2b_status_not_null CASCADE;
DROP FUNCTION IF EXISTS fn_enrich_b2b_invoices_vat_fr CASCADE;
DROP FUNCTION IF EXISTS fn_stuck_b2b_orders_count CASCADE;
DROP FUNCTION IF EXISTS get_cross_org_supplier_partners CASCADE;
DROP FUNCTION IF EXISTS resolve_client_products_for_reception CASCADE;
DROP FUNCTION IF EXISTS get_cross_org_supplier_units CASCADE;
DROP FUNCTION IF EXISTS get_cross_org_supplier_conversions CASCADE;
DROP FUNCTION IF EXISTS get_cross_org_catalog_products CASCADE;
DROP FUNCTION IF EXISTS fn_trg_b2b_line_deletion_guard CASCADE;
DROP FUNCTION IF EXISTS fn_trg_b2b_close_guard CASCADE;
DROP FUNCTION IF EXISTS fn_trg_b2b_mapping_guard CASCADE;
DROP FUNCTION IF EXISTS resolve_client_products_for_reception_v2 CASCADE;
DROP FUNCTION IF EXISTS fn_trg_b2b_status_transition_guard CASCADE;
DROP FUNCTION IF EXISTS fn_validate_b2b_discrepancy CASCADE;
DROP FUNCTION IF EXISTS get_linked_establishment_profiles CASCADE;
DROP FUNCTION IF EXISTS accept_supplier_invitation CASCADE;

-- 5. Drop B2B indexes
DROP INDEX IF EXISTS idx_invoice_suppliers_partner_est_id;
DROP INDEX IF EXISTS idx_invoices_b2b_order_id;
DROP INDEX IF EXISTS idx_invoices_b2b_unique_per_status;
DROP INDEX IF EXISTS idx_products_v2_source_product_id;

-- 6. Drop B2B constraints
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_b2b_order_id_fkey;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_b2b_status_check;

-- 7. Drop B2B columns
ALTER TABLE invoices DROP COLUMN IF EXISTS b2b_order_id;
ALTER TABLE invoices DROP COLUMN IF EXISTS b2b_status;
ALTER TABLE invoice_suppliers DROP COLUMN IF EXISTS partner_establishment_id;
ALTER TABLE products_v2 DROP COLUMN IF EXISTS source_product_id;
ALTER TABLE products_v2 DROP COLUMN IF EXISTS source_snapshot;
ALTER TABLE product_orders DROP COLUMN IF EXISTS source_name_snapshot;
ALTER TABLE product_orders DROP COLUMN IF EXISTS destination_name_snapshot;
