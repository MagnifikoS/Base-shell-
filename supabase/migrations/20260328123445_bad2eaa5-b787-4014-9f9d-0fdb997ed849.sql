-- BUG-002 FIX: Add HARD BLOCK 3 to fn_send_commande
-- Verifies B2B quantity convertibility BEFORE sending
-- Uses fn_convert_b2b_quantity as SSOT — no new conversion logic

CREATE OR REPLACE FUNCTION fn_send_commande(p_commande_id uuid)
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
  v_unconvertible_lines jsonb;
  v_zero_price_lines jsonb;
  v_b2b_unconvertible jsonb;
  v_partnership_id uuid;
  v_supplier_est_id uuid;
  v_client_est_id uuid;
BEGIN
  SELECT status, created_by, partnership_id, supplier_establishment_id, client_establishment_id
  INTO v_status, v_created_by, v_partnership_id, v_supplier_est_id, v_client_est_id
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

  -- ── HARD BLOCK 2: Unconvertible prices via fn_convert_line_unit_price (SSOT wrapper) ──
  SELECT jsonb_agg(jsonb_build_object(
    'product_name', cl.product_name_snapshot,
    'from_unit', COALESCE(mu_from.abbreviation, 'NULL'),
    'to_unit', COALESCE(mu_to.abbreviation, 'NULL'),
    'error', (fn_convert_line_unit_price(
      cl.product_id, p.final_unit_price, p.final_unit_id, cl.canonical_unit_id
    ))->>'error'
  ))
  INTO v_unconvertible_lines
  FROM commande_lines cl
  JOIN products_v2 p ON p.id = cl.product_id
  LEFT JOIN measurement_units mu_from ON mu_from.id = p.final_unit_id
  LEFT JOIN measurement_units mu_to ON mu_to.id = cl.canonical_unit_id
  WHERE cl.commande_id = p_commande_id
    AND (fn_convert_line_unit_price(
      cl.product_id, p.final_unit_price, p.final_unit_id, cl.canonical_unit_id
    ))->>'ok' = 'false';

  IF v_unconvertible_lines IS NOT NULL AND jsonb_array_length(v_unconvertible_lines) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'unconvertible_prices',
      'lines', v_unconvertible_lines
    );
  END IF;

  -- ── HARD BLOCK 3 (BUG-002): B2B quantity convertibility ──
  -- Verifies that fn_convert_b2b_quantity can resolve EVERY line
  -- before allowing the order to be sent. Uses the SSOT conversion engine.
  -- Only applies to B2B orders (partnership_id IS NOT NULL).
  IF v_partnership_id IS NOT NULL THEN
    SELECT jsonb_agg(jsonb_build_object(
      'product_name', cl.product_name_snapshot,
      'client_unit', COALESCE(mu_cl.name, 'NULL'),
      'supplier_unit', COALESCE(mu_sp.name, 'NULL'),
      'client_family', COALESCE(mu_cl.family, 'NULL'),
      'supplier_family', COALESCE(mu_sp.family, 'NULL')
    ))
    INTO v_b2b_unconvertible
    FROM commande_lines cl
    JOIN b2b_imported_products bip
      ON bip.local_product_id = cl.product_id
      AND bip.establishment_id = v_client_est_id
      AND bip.source_establishment_id = v_supplier_est_id
    JOIN products_v2 sp ON sp.id = bip.source_product_id
    LEFT JOIN measurement_units mu_cl ON mu_cl.id = cl.canonical_unit_id
    LEFT JOIN measurement_units mu_sp ON mu_sp.id = sp.stock_handling_unit_id
    CROSS JOIN LATERAL fn_convert_b2b_quantity(
      bip.source_product_id,
      cl.canonical_unit_id,
      cl.canonical_quantity
    ) AS conv
    WHERE cl.commande_id = p_commande_id
      AND conv.status = 'error';

    IF v_b2b_unconvertible IS NOT NULL AND jsonb_array_length(v_b2b_unconvertible) > 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'b2b_unconvertible',
        'lines', v_b2b_unconvertible
      );
    END IF;
  END IF;

  -- ── Snapshot prices using fn_convert_line_unit_price (SSOT, zero fallback) ──
  UPDATE commande_lines cl
  SET unit_price_snapshot = (
        (fn_convert_line_unit_price(
          cl.product_id, p.final_unit_price, p.final_unit_id, cl.canonical_unit_id
        ))->>'converted_price'
      )::numeric,
      line_total_snapshot = ROUND(
        cl.canonical_quantity * (
          (fn_convert_line_unit_price(
            cl.product_id, p.final_unit_price, p.final_unit_id, cl.canonical_unit_id
          ))->>'converted_price'
        )::numeric, 2)
  FROM products_v2 p
  WHERE cl.commande_id = p_commande_id
    AND cl.product_id = p.id;

  -- Final safety net
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
$$;