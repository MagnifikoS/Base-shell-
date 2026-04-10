
-- P1: Snapshot du nom du créateur (rempli à l'envoi)
ALTER TABLE public.commandes
  ADD COLUMN IF NOT EXISTS created_by_name_snapshot text;

-- P2: Numéro de commande unique global (assigné à l'envoi)
CREATE SEQUENCE IF NOT EXISTS public.commande_order_seq START 1;

ALTER TABLE public.commandes
  ADD COLUMN IF NOT EXISTS order_number text UNIQUE;

-- Modifier fn_send_commande pour remplir les 2 champs à l'envoi
CREATE OR REPLACE FUNCTION public.fn_send_commande(p_commande_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status commande_status;
  v_line_count INT;
  v_created_by uuid;
  v_display_name text;
  v_order_number text;
BEGIN
  -- Lock row
  SELECT status, created_by INTO v_status, v_created_by
  FROM commandes
  WHERE id = p_commande_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_status <> 'brouillon' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_brouillon');
  END IF;

  SELECT count(*) INTO v_line_count
  FROM commande_lines
  WHERE commande_id = p_commande_id;

  IF v_line_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_lines');
  END IF;

  -- P1: Resolve creator display name from profiles (snapshot)
  SELECT COALESCE(p.second_first_name, split_part(p.full_name, ' ', 1), p.full_name)
  INTO v_display_name
  FROM profiles p
  WHERE p.user_id = v_created_by AND p.status = 'active';

  -- P2: Generate unique order number
  v_order_number := 'CMD-' || lpad(nextval('commande_order_seq')::text, 6, '0');

  UPDATE commandes
  SET status = 'envoyee',
      sent_at = now(),
      updated_at = now(),
      created_by_name_snapshot = COALESCE(v_display_name, 'Utilisateur'),
      order_number = v_order_number
  WHERE id = p_commande_id;

  RETURN jsonb_build_object('ok', true, 'line_count', v_line_count, 'order_number', v_order_number);
END;
$$;
