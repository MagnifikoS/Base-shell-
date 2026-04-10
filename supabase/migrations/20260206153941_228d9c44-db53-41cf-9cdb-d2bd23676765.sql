-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD: Unique constraint to prevent duplicate invoices
-- Rule: Same establishment + supplier + date + amount = duplicate
-- ═══════════════════════════════════════════════════════════════════════════

-- Create unique index on invoices to prevent duplicates at DB level
-- This is a safety net for the application-level check
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_no_duplicates 
ON public.invoices (establishment_id, supplier_id, invoice_date, amount_eur);

-- Also add a unique constraint for exact reference matches (more common case)
-- Same supplier + same invoice number = definitely a duplicate
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_no_duplicate_ref 
ON public.invoices (establishment_id, supplier_id, invoice_number) 
WHERE invoice_number IS NOT NULL;