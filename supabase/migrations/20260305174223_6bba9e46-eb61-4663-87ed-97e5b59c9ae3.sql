
CREATE OR REPLACE FUNCTION public.trg_commandes_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.order_number IS NOT NULL AND NEW.order_number IS DISTINCT FROM OLD.order_number THEN
    RAISE EXCEPTION 'order_number is immutable once assigned';
  END IF;
  IF OLD.created_by_name_snapshot IS NOT NULL AND NEW.created_by_name_snapshot IS DISTINCT FROM OLD.created_by_name_snapshot THEN
    RAISE EXCEPTION 'created_by_name_snapshot is immutable once assigned';
  END IF;
  RETURN NEW;
END;
$$;
