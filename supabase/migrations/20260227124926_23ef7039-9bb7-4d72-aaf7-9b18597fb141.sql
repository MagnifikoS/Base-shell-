-- ÉTAPE 3 Migration 2/5: Validation trigger - b2b_status NOT NULL when b2b_order_id present
-- SCOPE: invoice-only. No changes to products/stock/inventory.
-- ROLLBACK: DROP TRIGGER IF EXISTS trg_validate_b2b_status ON public.invoices; DROP FUNCTION IF EXISTS public.fn_validate_b2b_status_not_null();

CREATE OR REPLACE FUNCTION public.fn_validate_b2b_status_not_null()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.b2b_order_id IS NOT NULL AND NEW.b2b_status IS NULL THEN
    RAISE EXCEPTION 'B2B invoice must have a non-null b2b_status when b2b_order_id is set (order_id=%)', NEW.b2b_order_id;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_validate_b2b_status
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_b2b_status_not_null();