
-- Fix search_path on guard_last_commande_line
CREATE OR REPLACE FUNCTION public.guard_last_commande_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_remaining int;
BEGIN
  SELECT c.status INTO v_status
  FROM commandes c
  WHERE c.id = OLD.commande_id;

  IF v_status IN ('envoyee', 'expediee', 'recue') THEN
    SELECT count(*) INTO v_remaining
    FROM commande_lines
    WHERE commande_id = OLD.commande_id
      AND id != OLD.id;

    IF v_remaining = 0 THEN
      RAISE EXCEPTION 'LAST_LINE_ENVOYEE: Cannot delete the last line of a sent/shipped/received commande';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;
