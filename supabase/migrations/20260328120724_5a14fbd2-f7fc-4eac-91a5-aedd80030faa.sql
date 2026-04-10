
-- BUG-001 FIX: Surgical correction of fn_send_commande price snapshot logic
-- 
-- Root cause: Two issues in the hard block + snapshot pipeline:
--   1. Hard block uses `!=` which evaluates to NULL when either operand is NULL,
--      silently SKIPPING those lines from the check (should use IS DISTINCT FROM)
--   2. COALESCE(..., 1.0) in the UPDATE provides a silent fallback that masks
--      any conversion failure that slips past the hard block
--
-- Fix: 
--   A. Use fn_convert_line_unit_price (the existing safe wrapper) instead of raw 
--      fn_product_unit_price_factor + COALESCE. This wrapper returns {ok:false} 
--      on any failure — no silent fallback.
--   B. Expand hard block to use IS DISTINCT FROM (NULL-safe) and also block
--      NULL/zero final_unit_price before snapshotting.
--   C. Remove COALESCE(..., 1.0) entirely — if hard block passes, conversion MUST work.

CREATE OR REPLACE FUNCTION public.fn_send_commande(p_commande_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_status commande_status;
  v_line_count INT;
  v_created_by uuid;
  v_display_name text;
  v_order_number text;
  v_missing_price_count INT;
  v_unconvertible_lines jsonb;
  v_zero_price_lines jsonb;
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

  -- ── HARD BLOCK 1: Products with NULL or zero price ──
  SELECT jsonb_agg(jsonb_build_object(
    'product_name', cl.product_name_snapshot,
    'price', p.final_unit_price
  ))
  INTO v_zero_price_lines
  FROM commande_lines cl
  JOIN products_v2 p ON p.id = cl.product_id
  WHERE cl.commande_id = p_commande_id
    AND (p.final_unit_price IS NULL OR p.final_unit_price <= 0);

  IF v_zero_price_lines IS NOT NULL AND jsonb_array_length(v_zero_price_lines) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'missing_price',
      'lines', v_zero_price_lines
    );
  END IF;

  -- ── HARD BLOCK 2: Unconvertible prices (NULL-safe with IS DISTINCT FROM) ──
  -- Uses fn_convert_line_unit_price which is the SSOT wrapper around BFS.
  -- Catches: NULL final_unit_id, NULL canonical_unit_id, missing BFS path.
  SELECT jsonb_agg(jsonb_build_object(
    'product_name', cl.product_name_snapshot,
    'from_unit', COALESCE(mu_from.abbreviation, 'NULL'),
    'to_unit', COALESCE(mu_to.abbreviation, 'NULL'),
    'error', (fn_convert_line_unit_price(
      cl.product_id, p.final_unit_id, cl.canonical_unit_id, p.final_unit_price
    ))->>'error'
  ))
  INTO v_unconvertible_lines
  FROM commande_lines cl
  JOIN products_v2 p ON p.id = cl.product_id
  LEFT JOIN measurement_units mu_from ON mu_from.id = p.final_unit_id
  LEFT JOIN measurement_units mu_to ON mu_to.id = cl.canonical_unit_id
  WHERE cl.commande_id = p_commande_id
    AND (
      -- Use the safe wrapper: if ok=false, the line is unconvertible
      (fn_convert_line_unit_price(
        cl.product_id, p.final_unit_id, cl.canonical_unit_id, p.final_unit_price
      ))->>'ok' = 'false'
    );

  IF v_unconvertible_lines IS NOT NULL AND jsonb_array_length(v_unconvertible_lines) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'unconvertible_prices',
      'lines', v_unconvertible_lines
    );
  END IF;

  -- ── Snapshot prices using fn_convert_line_unit_price (SSOT, no fallback) ──
  -- At this point, ALL lines are guaranteed convertible by the hard block above.
  UPDATE commande_lines cl
  SET unit_price_snapshot = (
        (fn_convert_line_unit_price(
          cl.product_id, p.final_unit_id, cl.canonical_unit_id, p.final_unit_price
        ))->>'converted_price'
      )::numeric,
      line_total_snapshot = ROUND(
        cl.canonical_quantity * (
          (fn_convert_line_unit_price(
            cl.product_id, p.final_unit_id, cl.canonical_unit_id, p.final_unit_price
          ))->>'converted_price'
        )::numeric, 2)
  FROM products_v2 p
  WHERE cl.commande_id = p_commande_id
    AND cl.product_id = p.id;

  -- Final safety net: verify no NULL prices escaped
  SELECT count(*) INTO v_missing_price_count
  FROM commande_lines
  WHERE commande_id = p_commande_id
    AND (unit_price_snapshot IS NULL OR line_total_snapshot IS NULL);

  IF v_missing_price_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'snapshot_failed', 'count', v_missing_price_count);
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

  RETURN jsonb_build_object(
    'ok', true,
    'order_number', v_order_number
  );
END;
$function$;
