-- ÉTAPE 3 Migration 5/5: Idempotent B2B invoice numbering trigger
-- SCOPE: invoice-only. No changes to products/stock/inventory.
-- ROLLBACK: DROP TRIGGER IF EXISTS trg_b2b_invoice_number ON public.invoices; DROP FUNCTION IF EXISTS public.fn_assign_b2b_invoice_number();

CREATE OR REPLACE FUNCTION public.fn_assign_b2b_invoice_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  -- Only assign to B2B invoices without an existing number (idempotent)
  IF NEW.b2b_order_id IS NOT NULL AND NEW.invoice_number IS NULL THEN
    NEW.invoice_number := 'FAC-B2B-' || lpad(nextval('public.b2b_invoice_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_b2b_invoice_number
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_assign_b2b_invoice_number();

-- Also fix search_path on migration 2 function
CREATE OR REPLACE FUNCTION public.fn_validate_b2b_status_not_null()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.b2b_order_id IS NOT NULL AND NEW.b2b_status IS NULL THEN
    RAISE EXCEPTION 'B2B invoice must have a non-null b2b_status when b2b_order_id is set (order_id=%)', NEW.b2b_order_id;
  END IF;
  RETURN NEW;
END;
$fn$;