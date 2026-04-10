
-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: Commandes V0 hardening
-- 1. FK commande_lines.canonical_unit_id → measurement_units(id)
-- 2. Trigger: block delete of last line when commande status = 'envoyee'
-- 3. Enable Realtime on commande_lines
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) FK on canonical_unit_id → measurement_units
ALTER TABLE public.commande_lines
  ADD CONSTRAINT commande_lines_canonical_unit_id_fkey
  FOREIGN KEY (canonical_unit_id)
  REFERENCES public.measurement_units(id);

-- Index for FK performance
CREATE INDEX IF NOT EXISTS idx_commande_lines_unit
  ON public.commande_lines (canonical_unit_id);

-- 2) Trigger: prevent deleting the last line of an envoyee commande
CREATE OR REPLACE FUNCTION public.trg_guard_last_commande_line()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_remaining int;
BEGIN
  -- Get the commande status
  SELECT status INTO v_status
  FROM commandes
  WHERE id = OLD.commande_id;

  -- Only guard envoyee commandes (brouillon = free to delete all, ouverte = RLS already blocks)
  IF v_status = 'envoyee' THEN
    SELECT count(*) INTO v_remaining
    FROM commande_lines
    WHERE commande_id = OLD.commande_id
      AND id <> OLD.id;

    IF v_remaining = 0 THEN
      RAISE EXCEPTION 'LAST_LINE_ENVOYEE: Impossible de supprimer la dernière ligne d''une commande envoyée.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER guard_last_commande_line
  BEFORE DELETE ON public.commande_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_guard_last_commande_line();

-- 3) Enable Realtime on commande_lines
ALTER PUBLICATION supabase_realtime ADD TABLE public.commande_lines;
