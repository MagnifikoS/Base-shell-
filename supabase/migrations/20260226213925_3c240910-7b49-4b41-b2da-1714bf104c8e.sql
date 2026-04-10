-- Fix: Exclude B2B auto-generated invoices from the manual dedup index
-- B2B invoices have their own idempotency guard (b2b_order_id check in RPC)
-- This prevents false duplicate conflicts when same supplier, same day, same amount

-- Drop the old index that blocks legitimate B2B invoices
DROP INDEX IF EXISTS idx_invoices_no_duplicates;

-- Recreate it ONLY for manual invoices (where b2b_order_id IS NULL)
CREATE UNIQUE INDEX idx_invoices_no_duplicates 
  ON public.invoices (establishment_id, supplier_id, invoice_date, amount_eur)
  WHERE b2b_order_id IS NULL;

-- Also fix the invoice_number dedup index for same reason
DROP INDEX IF EXISTS idx_invoices_no_duplicate_ref;

CREATE UNIQUE INDEX idx_invoices_no_duplicate_ref 
  ON public.invoices (establishment_id, supplier_id, invoice_number)
  WHERE invoice_number IS NOT NULL AND b2b_order_id IS NULL;