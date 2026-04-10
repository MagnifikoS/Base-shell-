-- ============================================================
-- PATCH P1: Add invoice_number to invoices + supplier details
-- ============================================================

-- 1. Add invoice_number to invoices table
ALTER TABLE public.invoices 
ADD COLUMN IF NOT EXISTS invoice_number TEXT NULL;

-- 2. Add supplier details columns to invoice_suppliers table
ALTER TABLE public.invoice_suppliers 
ADD COLUMN IF NOT EXISTS siret TEXT NULL,
ADD COLUMN IF NOT EXISTS iban_masked TEXT NULL,
ADD COLUMN IF NOT EXISTS billing_address TEXT NULL,
ADD COLUMN IF NOT EXISTS city TEXT NULL,
ADD COLUMN IF NOT EXISTS postal_code TEXT NULL,
ADD COLUMN IF NOT EXISTS country TEXT NULL,
ADD COLUMN IF NOT EXISTS contact_name TEXT NULL,
ADD COLUMN IF NOT EXISTS contact_email TEXT NULL,
ADD COLUMN IF NOT EXISTS contact_phone TEXT NULL;

-- 3. Add index for duplicate detection (supplier + invoice_number + date)
CREATE INDEX IF NOT EXISTS idx_invoices_duplicate_check 
ON public.invoices (supplier_id, invoice_number, invoice_date) 
WHERE invoice_number IS NOT NULL;