
-- ═══════════════════════════════════════════════════════════════
-- COMMANDES B2B ÉTAPE 2 — Migration
-- New statuses, preparation/shipping/reception columns, RPCs
-- ═══════════════════════════════════════════════════════════════

-- 1) Add new enum values
ALTER TYPE public.commande_status ADD VALUE IF NOT EXISTS 'expediee';
ALTER TYPE public.commande_status ADD VALUE IF NOT EXISTS 'recue';

-- 2) Add columns to commande_lines for preparation/reception tracking
ALTER TABLE public.commande_lines
  ADD COLUMN IF NOT EXISTS shipped_quantity numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS received_quantity numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS line_status text DEFAULT NULL;
-- line_status: null (not processed), 'ok', 'modifie', 'rupture'

-- 3) Add columns to commandes for shipping/reception tracking
ALTER TABLE public.commandes
  ADD COLUMN IF NOT EXISTS shipped_by text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS received_by text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS received_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reception_type text DEFAULT NULL;
-- reception_type: 'complete' or 'partielle'

-- 4) RPC: fn_ship_commande — atomic: set shipped quantities, update status, create stock events
CREATE OR REPLACE FUNCTION public.fn_ship_commande(
  p_commande_id uuid,
  p_user_id uuid,
  p_lines jsonb  -- array of {line_id, shipped_quantity, line_status}
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commande record;
  v_line record;
  v_line_input jsonb;
  v_all_processed boolean := true;
  v_line_count int := 0;
BEGIN
  -- Lock the commande row
  SELECT * INTO v_commande
  FROM commandes
  WHERE id = p_commande_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'commande_not_found');
  END IF;

  IF v_commande.status != 'ouverte' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'current', v_commande.status);
  END IF;

  -- Process each line
  FOR v_line_input IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    UPDATE commande_lines
    SET shipped_quantity = (v_line_input->>'shipped_quantity')::numeric,
        line_status = v_line_input->>'line_status'
    WHERE id = (v_line_input->>'line_id')::uuid
      AND commande_id = p_commande_id;

    v_line_count := v_line_count + 1;
  END LOOP;

  -- Check all lines are processed
  SELECT NOT EXISTS (
    SELECT 1 FROM commande_lines
    WHERE commande_id = p_commande_id
      AND line_status IS NULL
  ) INTO v_all_processed;

  IF NOT v_all_processed THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lines_not_all_processed');
  END IF;

  -- Update commande status
  UPDATE commandes
  SET status = 'expediee',
      shipped_by = p_user_id::text,
      shipped_at = now(),
      updated_at = now()
  WHERE id = p_commande_id;

  RETURN jsonb_build_object('ok', true, 'line_count', v_line_count);
END;
$$;

-- 5) RPC: fn_receive_commande — atomic: set received quantities, update status
CREATE OR REPLACE FUNCTION public.fn_receive_commande(
  p_commande_id uuid,
  p_user_id uuid,
  p_lines jsonb  -- array of {line_id, received_quantity}
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commande record;
  v_line_input jsonb;
  v_line_count int := 0;
  v_is_complete boolean := true;
  v_line record;
BEGIN
  -- Lock the commande row
  SELECT * INTO v_commande
  FROM commandes
  WHERE id = p_commande_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'commande_not_found');
  END IF;

  IF v_commande.status != 'expediee' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'current', v_commande.status);
  END IF;

  -- Process each line
  FOR v_line_input IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    UPDATE commande_lines
    SET received_quantity = (v_line_input->>'received_quantity')::numeric
    WHERE id = (v_line_input->>'line_id')::uuid
      AND commande_id = p_commande_id;

    v_line_count := v_line_count + 1;
  END LOOP;

  -- Determine if complete or partial reception
  FOR v_line IN
    SELECT shipped_quantity, received_quantity
    FROM commande_lines
    WHERE commande_id = p_commande_id
  LOOP
    IF COALESCE(v_line.received_quantity, 0) != COALESCE(v_line.shipped_quantity, 0) THEN
      v_is_complete := false;
      EXIT;
    END IF;
  END LOOP;

  -- Update commande status
  UPDATE commandes
  SET status = 'recue',
      received_by = p_user_id::text,
      received_at = now(),
      reception_type = CASE WHEN v_is_complete THEN 'complete' ELSE 'partielle' END,
      updated_at = now()
  WHERE id = p_commande_id;

  RETURN jsonb_build_object(
    'ok', true,
    'line_count', v_line_count,
    'reception_type', CASE WHEN v_is_complete THEN 'complete' ELSE 'partielle' END
  );
END;
$$;

-- 6) Update RLS: allow update on commande_lines for shipped_quantity/received_quantity/line_status
-- The existing RLS policies cover SELECT/INSERT/DELETE. We need UPDATE for preparation.
-- Check if a policy already allows supplier to update lines of ouverte commandes.
-- We add a policy for supplier to update lines when commande is ouverte (preparation)
CREATE POLICY "Supplier can update lines during preparation"
ON public.commande_lines
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM commandes c
    WHERE c.id = commande_lines.commande_id
      AND c.status = 'ouverte'
      AND c.supplier_establishment_id IN (
        SELECT ue.establishment_id FROM user_establishments ue WHERE ue.user_id = auth.uid()
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM commandes c
    WHERE c.id = commande_lines.commande_id
      AND c.status = 'ouverte'
      AND c.supplier_establishment_id IN (
        SELECT ue.establishment_id FROM user_establishments ue WHERE ue.user_id = auth.uid()
      )
  )
);

-- 7) Update guard trigger to also protect expediee and recue from line deletion
CREATE OR REPLACE FUNCTION public.guard_last_commande_line()
RETURNS trigger
LANGUAGE plpgsql
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
