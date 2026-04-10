
-- ═══════════════════════════════════════════════════════════════════════════
-- FIX fn_send_commande: convert unit_price_snapshot using BFS factor
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_missing_price_count INT;
BEGIN
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

  -- ── Figer les prix avec CONVERSION D'UNITÉ via BFS ──
  -- final_unit_price est en €/final_unit. On le convertit en €/canonical_unit_commande.
  UPDATE commande_lines cl
  SET unit_price_snapshot = ROUND(
        p.final_unit_price * COALESCE(
          fn_product_unit_price_factor(cl.product_id, p.final_unit_id, cl.canonical_unit_id),
          1.0
        ), 4),
      line_total_snapshot = ROUND(
        cl.canonical_quantity * p.final_unit_price * COALESCE(
          fn_product_unit_price_factor(cl.product_id, p.final_unit_id, cl.canonical_unit_id),
          1.0
        ), 2)
  FROM products_v2 p
  WHERE cl.commande_id = p_commande_id
    AND cl.product_id = p.id;

  -- Vérifier qu'aucun prix n'est NULL
  SELECT count(*) INTO v_missing_price_count
  FROM commande_lines
  WHERE commande_id = p_commande_id
    AND unit_price_snapshot IS NULL;

  IF v_missing_price_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_price', 'count', v_missing_price_count);
  END IF;

  -- Snapshot creator name
  SELECT COALESCE(p.second_first_name, split_part(p.full_name, ' ', 1), p.full_name)
  INTO v_display_name
  FROM profiles p
  WHERE p.user_id = v_created_by AND p.status = 'active';

  -- Generate order number
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
