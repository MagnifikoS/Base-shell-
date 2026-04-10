-- ÉTAPE 3 Migration 3/5: Partial unique index on (b2b_order_id, b2b_status)
-- SCOPE: invoice-only. No changes to products/stock/inventory.
-- ROLLBACK: DROP INDEX IF EXISTS public.idx_invoices_b2b_unique_per_status;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_b2b_unique_per_status
  ON public.invoices (b2b_order_id, b2b_status)
  WHERE b2b_order_id IS NOT NULL AND b2b_status IS NOT NULL;