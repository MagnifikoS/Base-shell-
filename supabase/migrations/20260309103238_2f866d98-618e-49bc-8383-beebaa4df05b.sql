-- ═══════════════════════════════════════════════════════════════════════════
-- Commandes Plats Lifecycle RPCs — 100% isolated from product commandes
-- NO stock logic, NO ledger, NO products_v2 references
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. fn_send_commande_plat ──
CREATE OR REPLACE FUNCTION public.fn_send_commande_plat(p_commande_plat_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cmd commande_plats%ROWTYPE;
  v_line_count int;
  v_order_number text;
BEGIN
  SELECT * INTO v_cmd FROM commande_plats WHERE id = p_commande_plat_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_cmd.status <> 'brouillon' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'current', v_cmd.status);
  END IF;

  SELECT count(*) INTO v_line_count FROM commande_plat_lines WHERE commande_plat_id = p_commande_plat_id;
  IF v_line_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_lines');
  END IF;

  v_order_number := 'CP-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0');

  UPDATE commande_plats
  SET status = 'envoyee', sent_at = now(), order_number = v_order_number, updated_at = now()
  WHERE id = p_commande_plat_id;

  UPDATE commande_plat_lines
  SET line_total_snapshot = quantity * unit_price_snapshot
  WHERE commande_plat_id = p_commande_plat_id AND line_total_snapshot IS NULL;

  RETURN jsonb_build_object('ok', true, 'order_number', v_order_number, 'line_count', v_line_count);
END;
$$;

-- ── 2. fn_open_commande_plat ──
CREATE OR REPLACE FUNCTION public.fn_open_commande_plat(p_commande_plat_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cmd commande_plats%ROWTYPE;
  v_already boolean := false;
BEGIN
  SELECT * INTO v_cmd FROM commande_plats WHERE id = p_commande_plat_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_cmd.status = 'ouverte' THEN
    v_already := true;
  ELSIF v_cmd.status <> 'envoyee' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'current', v_cmd.status);
  END IF;

  IF NOT v_already THEN
    UPDATE commande_plats
    SET status = 'ouverte', opened_at = now(), opened_by = p_user_id, updated_at = now()
    WHERE id = p_commande_plat_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'already_opened', v_already);
END;
$$;

-- ── 3. fn_ship_commande_plat ──
CREATE OR REPLACE FUNCTION public.fn_ship_commande_plat(
  p_commande_plat_id uuid,
  p_user_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cmd commande_plats%ROWTYPE;
  v_line record;
  v_count int := 0;
BEGIN
  SELECT * INTO v_cmd FROM commande_plats WHERE id = p_commande_plat_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_cmd.status NOT IN ('ouverte', 'envoyee') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'current', v_cmd.status);
  END IF;

  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(line_id uuid, shipped_quantity int, line_status text)
  LOOP
    UPDATE commande_plat_lines
    SET shipped_quantity = v_line.shipped_quantity,
        line_status = v_line.line_status
    WHERE id = v_line.line_id AND commande_plat_id = p_commande_plat_id;
    v_count := v_count + 1;
  END LOOP;

  UPDATE commande_plats
  SET status = 'expediee', shipped_at = now(), shipped_by = p_user_id, updated_at = now()
  WHERE id = p_commande_plat_id;

  RETURN jsonb_build_object('ok', true, 'line_count', v_count);
END;
$$;

-- ── 4. fn_receive_commande_plat ──
CREATE OR REPLACE FUNCTION public.fn_receive_commande_plat(
  p_commande_plat_id uuid,
  p_user_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cmd commande_plats%ROWTYPE;
  v_line record;
  v_count int := 0;
  v_has_discrepancy boolean := false;
  v_shipped int;
  v_received int;
BEGIN
  SELECT * INTO v_cmd FROM commande_plats WHERE id = p_commande_plat_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_cmd.status <> 'expediee' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'current', v_cmd.status);
  END IF;

  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(line_id uuid, received_quantity int)
  LOOP
    SELECT COALESCE(shipped_quantity, 0) INTO v_shipped
    FROM commande_plat_lines WHERE id = v_line.line_id AND commande_plat_id = p_commande_plat_id;

    v_received := v_line.received_quantity;

    UPDATE commande_plat_lines
    SET received_quantity = v_received
    WHERE id = v_line.line_id AND commande_plat_id = p_commande_plat_id;

    IF v_received <> v_shipped THEN
      v_has_discrepancy := true;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  IF v_has_discrepancy THEN
    INSERT INTO litige_plats (commande_plat_id, created_by, status)
    VALUES (p_commande_plat_id, p_user_id, 'ouvert')
    ON CONFLICT (commande_plat_id) DO NOTHING;

    INSERT INTO litige_plat_lines (litige_plat_id, commande_plat_line_id, shipped_quantity_snapshot, received_quantity_snapshot, delta)
    SELECT
      lp.id,
      cpl.id,
      COALESCE(cpl.shipped_quantity, 0),
      cpl.received_quantity,
      COALESCE(cpl.received_quantity, 0) - COALESCE(cpl.shipped_quantity, 0)
    FROM commande_plat_lines cpl
    JOIN litige_plats lp ON lp.commande_plat_id = p_commande_plat_id
    WHERE cpl.commande_plat_id = p_commande_plat_id
      AND cpl.received_quantity IS NOT NULL
      AND cpl.received_quantity <> COALESCE(cpl.shipped_quantity, 0)
    ON CONFLICT DO NOTHING;

    UPDATE commande_plats
    SET status = 'litige', received_at = now(), received_by = p_user_id, updated_at = now()
    WHERE id = p_commande_plat_id;

    RETURN jsonb_build_object('ok', true, 'line_count', v_count, 'has_litige', true, 'reception_type', 'partielle');
  ELSE
    UPDATE commande_plats
    SET status = 'recue', received_at = now(), received_by = p_user_id, updated_at = now()
    WHERE id = p_commande_plat_id;

    RETURN jsonb_build_object('ok', true, 'line_count', v_count, 'has_litige', false, 'reception_type', 'complete');
  END IF;
END;
$$;

-- ── 5. fn_resolve_litige_plat ──
CREATE OR REPLACE FUNCTION public.fn_resolve_litige_plat(p_litige_plat_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_litige litige_plats%ROWTYPE;
BEGIN
  SELECT * INTO v_litige FROM litige_plats WHERE id = p_litige_plat_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_litige.status <> 'ouvert' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_resolved');
  END IF;

  UPDATE litige_plats
  SET status = 'resolu', resolved_at = now(), resolved_by = p_user_id
  WHERE id = p_litige_plat_id;

  UPDATE commande_plats
  SET status = 'cloturee', updated_at = now()
  WHERE id = v_litige.commande_plat_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;