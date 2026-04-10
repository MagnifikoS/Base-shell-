
-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 6: Read-only views for B2B coherence dashboard
-- These views power the admin dashboard. No writes, no triggers.
-- ═══════════════════════════════════════════════════════════════════════════

-- VIEW 1: Triangulation BL ↔ Invoice ↔ Stock
CREATE OR REPLACE VIEW public.v_b2b_coherence_triangulation AS
SELECT
  po.id AS order_id,
  po.source_name_snapshot AS client_name,
  po.destination_name_snapshot AS supplier_name,
  po.created_at AS order_date,
  bl_totals.bl_total,
  inv_totals.invoice_total,
  bl_totals.bl_qty_total,
  se_totals.stock_qty_total,
  ROUND(COALESCE(bl_totals.bl_total, 0) - COALESCE(inv_totals.invoice_total, 0), 2) AS delta_monetary,
  ROUND(COALESCE(bl_totals.bl_qty_total, 0) - COALESCE(ABS(se_totals.stock_qty_total), 0), 4) AS delta_qty
FROM product_orders po
LEFT JOIN LATERAL (
  SELECT
    ROUND(COALESCE(SUM(bwl.line_total_snapshot), 0), 2) AS bl_total,
    ROUND(COALESCE(SUM(bwl.quantity_canonical), 0), 4) AS bl_qty_total
  FROM bl_withdrawal_lines bwl
  WHERE bwl.bl_withdrawal_document_id = po.bl_retrait_document_id
) bl_totals ON true
LEFT JOIN LATERAL (
  SELECT ROUND(COALESCE(SUM(i.amount_eur), 0), 2) AS invoice_total
  FROM invoices i
  WHERE i.b2b_order_id = po.id AND i.b2b_status = 'issued'
) inv_totals ON true
LEFT JOIN LATERAL (
  SELECT ROUND(COALESCE(SUM(se.delta_quantity_canonical), 0), 4) AS stock_qty_total
  FROM stock_events se
  JOIN stock_documents sd ON sd.id = se.document_id
  WHERE sd.idempotency_key LIKE 'b2b-reception-' || po.id::text || '%'
    AND se.event_type = 'WITHDRAWAL'
) se_totals ON true
WHERE po.status = 'closed'
  AND po.bl_retrait_document_id IS NOT NULL;


-- VIEW 2: Reconciliation inter-establishments (per product)
CREATE OR REPLACE VIEW public.v_b2b_coherence_reconciliation AS
SELECT
  po.id AS order_id,
  po.source_name_snapshot AS client_name,
  po.destination_name_snapshot AS supplier_name,
  po.created_at AS order_date,
  pol.product_id AS client_product_id,
  pol.resolved_supplier_product_id AS supplier_product_id,
  pol.product_name_snapshot,
  pol.quantity_prepared AS qty_supplier,
  pol.quantity_received AS qty_client,
  ROUND(COALESCE(pol.quantity_prepared, 0) - COALESCE(pol.quantity_received, 0), 4) AS delta
FROM product_orders po
JOIN product_order_lines pol ON pol.order_id = po.id
WHERE po.status = 'closed';


-- VIEW 3: Orphan VAT invoices
CREATE OR REPLACE VIEW public.v_b2b_coherence_vat_orphans AS
SELECT
  i.id AS invoice_id,
  i.b2b_order_id AS order_id,
  i.b2b_status,
  i.amount_eur,
  i.amount_ht,
  i.vat_amount,
  i.created_at
FROM invoices i
JOIN product_orders po ON po.id = i.b2b_order_id
WHERE po.status = 'closed'
  AND i.b2b_status IS NOT NULL
  AND i.vat_enriched_at IS NULL;
