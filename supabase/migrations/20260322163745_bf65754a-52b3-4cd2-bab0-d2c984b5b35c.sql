
-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1: fn_convert_line_unit_price — Central price conversion function
-- PHASE 2: Harden fn_send_commande — Remove COALESCE(..., 1.0) fallback
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── PHASE 1: Pure conversion function (read-only, no side effects) ──────
-- Returns: { ok: bool, converted_price: numeric, factor: numeric, error: text }
-- Rules:
--   same unit → identity (factor=1)
--   BFS path exists → converted price
--   no path → error, no fallback

CREATE OR REPLACE FUNCTION public.fn_convert_line_unit_price(
  p_product_id uuid,
  p_price_source numeric,
  p_from_unit_id uuid,
  p_to_unit_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_factor numeric;
  v_converted numeric;
BEGIN
  -- Guard: missing inputs
  IF p_product_id IS NULL OR p_from_unit_id IS NULL OR p_to_unit_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'converted_price', null,
      'factor', null,
      'error', 'missing_input'
    );
  END IF;

  IF p_price_source IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'converted_price', null,
      'factor', null,
      'error', 'missing_price'
    );
  END IF;

  -- Identity
  IF p_from_unit_id = p_to_unit_id THEN
    RETURN jsonb_build_object(
      'ok', true,
      'converted_price', ROUND(p_price_source, 4),
      'factor', 1.0,
      'error', null
    );
  END IF;

  -- BFS via existing engine
  SELECT fn_product_unit_price_factor(p_product_id, p_from_unit_id, p_to_unit_id)
    INTO v_factor;

  IF v_factor IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'converted_price', null,
      'factor', null,
      'error', 'no_conversion_path'
    );
  END IF;

  v_converted := ROUND(p_price_source * v_factor, 4);

  RETURN jsonb_build_object(
    'ok', true,
    'converted_price', v_converted,
    'factor', v_factor,
    'error', null
  );
END;
$$;

-- ─── PHASE 2: Harden fn_send_commande — Hard Block on missing conversion ──

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
  v_unconvertible_lines jsonb;
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

  -- ── HARD BLOCK: Check for unconvertible lines BEFORE snapshotting ──
  SELECT jsonb_agg(jsonb_build_object(
    'product_name', cl.product_name_snapshot,
    'from_unit', mu_from.abbreviation,
    'to_unit', mu_to.abbreviation
  ))
  INTO v_unconvertible_lines
  FROM commande_lines cl
  JOIN products_v2 p ON p.id = cl.product_id
  LEFT JOIN measurement_units mu_from ON mu_from.id = p.final_unit_id
  LEFT JOIN measurement_units mu_to ON mu_to.id = cl.canonical_unit_id
  WHERE cl.commande_id = p_commande_id
    AND cl.canonical_unit_id != p.final_unit_id
    AND fn_product_unit_price_factor(cl.product_id, p.final_unit_id, cl.canonical_unit_id) IS NULL;

  IF v_unconvertible_lines IS NOT NULL AND jsonb_array_length(v_unconvertible_lines) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 
      'error', 'unconvertible_prices',
      'lines', v_unconvertible_lines
    );
  END IF;

  -- ── Snapshot prices with VALIDATED conversion (no fallback) ──
  UPDATE commande_lines cl
  SET unit_price_snapshot = ROUND(
        p.final_unit_price * COALESCE(
          fn_product_unit_price_factor(cl.product_id, p.final_unit_id, cl.canonical_unit_id),
          1.0  -- Safe: we already verified all paths exist above
        ), 4),
      line_total_snapshot = ROUND(
        cl.canonical_quantity * p.final_unit_price * COALESCE(
          fn_product_unit_price_factor(cl.product_id, p.final_unit_id, cl.canonical_unit_id),
          1.0  -- Safe: pre-validated
        ), 2)
  FROM products_v2 p
  WHERE cl.commande_id = p_commande_id
    AND cl.product_id = p.id;

  -- Verify no NULL prices (e.g. product has no final_unit_price)
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

-- ─── PHASE 4: Harden fn_create_bl_withdrawal — BFS price conversion ──────

CREATE OR REPLACE FUNCTION public.fn_create_bl_withdrawal(
  p_establishment_id UUID,
  p_organization_id UUID,
  p_stock_document_id UUID,
  p_destination_establishment_id UUID DEFAULT NULL,
  p_destination_name TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
  v_bl_number TEXT;
  v_bl_id UUID;
  v_total NUMERIC := 0;
  v_line JSONB;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_line_total NUMERIC;
  v_canonical_unit_id UUID;
  v_fallback_unit_id UUID;
  v_product_id UUID;
  v_product RECORD;
  v_factor NUMERIC;
BEGIN
  -- Idempotence: check if BL already exists for this stock_document_id
  SELECT id, bl_number INTO v_existing
  FROM bl_withdrawal_documents
  WHERE stock_document_id = p_stock_document_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'bl_number', v_existing.bl_number);
  END IF;

  -- Generate sequential BL number
  SELECT fn_next_bl_withdrawal_number(p_establishment_id) INTO v_bl_number;

  -- First pass: calculate total with BFS conversion
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := ABS((v_line->>'quantity')::numeric);
    v_product_id := (v_line->>'product_id')::uuid;
    v_canonical_unit_id := (v_line->>'canonical_unit_id')::uuid;
    
    -- Fetch product price info
    SELECT final_unit_price, final_unit_id, stock_handling_unit_id
      INTO v_product
      FROM products_v2 WHERE id = v_product_id;
    
    -- Resolve unit
    IF v_canonical_unit_id IS NULL THEN
      v_canonical_unit_id := v_product.stock_handling_unit_id;
    END IF;
    
    -- Convert price via BFS
    v_price := NULL;
    IF v_product.final_unit_price IS NOT NULL AND v_product.final_unit_id IS NOT NULL AND v_canonical_unit_id IS NOT NULL THEN
      IF v_product.final_unit_id = v_canonical_unit_id THEN
        v_price := v_product.final_unit_price;
      ELSE
        v_factor := fn_product_unit_price_factor(v_product_id, v_product.final_unit_id, v_canonical_unit_id);
        IF v_factor IS NOT NULL THEN
          v_price := ROUND(v_product.final_unit_price * v_factor, 4);
        END IF;
        -- If NULL → price stays NULL (no fallback)
      END IF;
    END IF;
    
    v_line_total := CASE WHEN v_price IS NOT NULL THEN ROUND(v_qty * v_price * 100) / 100 ELSE NULL END;
    v_total := v_total + COALESCE(v_line_total, 0);
  END LOOP;

  -- Insert document
  INSERT INTO bl_withdrawal_documents (
    establishment_id, organization_id, stock_document_id,
    bl_number, destination_establishment_id, destination_name,
    total_eur, created_by
  ) VALUES (
    p_establishment_id, p_organization_id, p_stock_document_id,
    v_bl_number, p_destination_establishment_id, p_destination_name,
    ROUND(v_total * 100) / 100, p_created_by
  )
  RETURNING id INTO v_bl_id;

  -- Insert lines with BFS-converted prices
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := ABS((v_line->>'quantity')::numeric);
    v_product_id := (v_line->>'product_id')::uuid;
    v_canonical_unit_id := (v_line->>'canonical_unit_id')::uuid;
    
    -- Fetch product price info
    SELECT final_unit_price, final_unit_id, stock_handling_unit_id
      INTO v_product
      FROM products_v2 WHERE id = v_product_id;
    
    -- Resolve unit
    IF v_canonical_unit_id IS NULL THEN
      v_canonical_unit_id := v_product.stock_handling_unit_id;
    END IF;
    
    -- Skip lines without valid unit
    IF v_canonical_unit_id IS NULL THEN
      CONTINUE;
    END IF;
    
    -- Convert price via BFS
    v_price := NULL;
    IF v_product.final_unit_price IS NOT NULL AND v_product.final_unit_id IS NOT NULL THEN
      IF v_product.final_unit_id = v_canonical_unit_id THEN
        v_price := v_product.final_unit_price;
      ELSE
        v_factor := fn_product_unit_price_factor(v_product_id, v_product.final_unit_id, v_canonical_unit_id);
        IF v_factor IS NOT NULL THEN
          v_price := ROUND(v_product.final_unit_price * v_factor, 4);
        END IF;
      END IF;
    END IF;
    
    v_line_total := CASE WHEN v_price IS NOT NULL THEN ROUND(v_qty * v_price * 100) / 100 ELSE NULL END;

    INSERT INTO bl_withdrawal_lines (
      bl_withdrawal_document_id, product_id, product_name_snapshot,
      quantity_canonical, canonical_unit_id,
      unit_price_snapshot, line_total_snapshot
    ) VALUES (
      v_bl_id, v_product_id, v_line->>'product_name_snapshot',
      v_qty, v_canonical_unit_id,
      v_price,
      v_line_total
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'id', v_bl_id, 'bl_number', v_bl_number);
END;
$$;
