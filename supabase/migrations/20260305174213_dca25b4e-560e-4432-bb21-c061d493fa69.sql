
-- Garde-fou: empêcher toute modification de order_number et created_by_name_snapshot une fois assignés
CREATE OR REPLACE FUNCTION public.trg_commandes_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- order_number: once set, never changed
  IF OLD.order_number IS NOT NULL AND NEW.order_number IS DISTINCT FROM OLD.order_number THEN
    RAISE EXCEPTION 'order_number is immutable once assigned';
  END IF;
  -- created_by_name_snapshot: once set, never changed
  IF OLD.created_by_name_snapshot IS NOT NULL AND NEW.created_by_name_snapshot IS DISTINCT FROM OLD.created_by_name_snapshot THEN
    RAISE EXCEPTION 'created_by_name_snapshot is immutable once assigned';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_commandes_immutable_fields
  BEFORE UPDATE ON public.commandes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_commandes_immutable_fields();
