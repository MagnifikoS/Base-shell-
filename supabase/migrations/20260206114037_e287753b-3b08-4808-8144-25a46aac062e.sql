-- ═══════════════════════════════════════════════════════════════════════════
-- FOURNISSEURS V1 - Schema Update for invoice_suppliers
-- Adding missing columns for full supplier management
-- ═══════════════════════════════════════════════════════════════════════════

-- Add missing columns to invoice_suppliers
ALTER TABLE public.invoice_suppliers
ADD COLUMN IF NOT EXISTS name_normalized text,
ADD COLUMN IF NOT EXISTS trade_name text,
ADD COLUMN IF NOT EXISTS supplier_type text,
ADD COLUMN IF NOT EXISTS vat_number text,
ADD COLUMN IF NOT EXISTS internal_code text,
ADD COLUMN IF NOT EXISTS notes text,
ADD COLUMN IF NOT EXISTS payment_terms text,
ADD COLUMN IF NOT EXISTS payment_delay_days integer,
ADD COLUMN IF NOT EXISTS payment_method text,
ADD COLUMN IF NOT EXISTS currency text DEFAULT 'EUR',
ADD COLUMN IF NOT EXISTS tags text[],
ADD COLUMN IF NOT EXISTS address_line2 text;

-- Create unique constraint on (establishment_id, name_normalized) for deduplication
-- First, populate name_normalized for existing records
UPDATE public.invoice_suppliers 
SET name_normalized = public.normalize_supplier_name(name)
WHERE name_normalized IS NULL;

-- Create trigger to auto-normalize name on insert/update
CREATE OR REPLACE FUNCTION public.fn_suppliers_normalize_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.name IS NOT NULL AND NEW.name != '' THEN
    NEW.name_normalized := public.normalize_supplier_name(NEW.name);
  ELSE
    NEW.name_normalized := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_suppliers_normalize_name ON public.invoice_suppliers;
CREATE TRIGGER trg_suppliers_normalize_name
  BEFORE INSERT OR UPDATE ON public.invoice_suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_suppliers_normalize_name();

-- Create unique index for deduplication (only active suppliers)
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_suppliers_name_normalized_unique
ON public.invoice_suppliers (establishment_id, name_normalized)
WHERE archived_at IS NULL;

-- Add module 'fournisseurs' to modules table
INSERT INTO public.modules (key, name, display_order)
VALUES ('fournisseurs', 'Fournisseurs', 103)
ON CONFLICT (key) DO NOTHING;