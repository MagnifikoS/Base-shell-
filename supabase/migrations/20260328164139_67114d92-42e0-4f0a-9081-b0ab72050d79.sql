
CREATE OR REPLACE FUNCTION public.fn_resolve_litige(p_litige_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_litige RECORD;
  v_commande RECORD;
  v_org_id uuid;
  v_zone_id uuid;
  v_doc_id uuid;
  v_post_result jsonb;
  v_idemp_key text;
  v_adjusted_count int := 0;
  v_conversion_error_count int := 0;
BEGIN
  SELECT * INTO v_litige FROM litiges WHERE id = p_litige_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'litige_not_found');
  END IF;
  IF v_litige.status != 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_resolved');
  END IF;

  SELECT * INTO v_commande FROM commandes WHERE id = v_litige.commande_id FOR UPDATE;
  IF v_commande.status != 'litige' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_commande_status');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_establishments
    WHERE user_id = p_user_id AND establishment_id = v_commande.supplier_establishment_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'access_denied');
  END IF;

  SELECT organization_id INTO v_org_id
  FROM establishments WHERE id = v_commande.supplier_establishment_id;

  -- ══════════════════════════════════════════════════════════════════════
  -- NEW BUSINESS RULE: Use REAL stock debited (from stock_events) instead
  -- of shipped_quantity (which is now supplier's declaration, not stock truth).
  --
  -- real_stock_debited = SUM(ABS(se.delta_quantity_canonical))
  --   from stock_events linked to the shipment documents of this commande.
  --
  -- correction_delta = real_stock_debited - received_quantity
  --   If positive: supplier gets stock back (client received less than physically shipped)
  --   If negative: supplier loses more stock (client received more than physically shipped)
  --   If zero: no adjustment needed
  --
  -- This naturally handles mutualized products because stock_events already
  -- contain the real per-member debits from the recursive allocation engine.
  -- ══════════════════════════════════════════════════════════════════════
  CREATE TEMP TABLE _litige_adj_lines ON COMMIT DROP AS
  SELECT DISTINCT ON (ll.id)
    ll.id AS ll_id,
    ll.commande_line_id,
    -- Real stock debited for this line (from stock_events via source_line_id)
    COALESCE(real_ship.real_debited, 0) AS real_stock_debited,
    ll.received_quantity AS received_qty,
    -- The real delta: what was physically shipped minus what client received
    COALESCE(real_ship.real_debited, 0) - ll.received_quantity AS real_delta,
    cl.canonical_unit_id AS client_unit_id,
    bip.source_product_id AS supplier_product_id,
    sp.storage_zone_id AS supplier_zone_id,
    (fn_convert_b2b_quantity(
      bip.source_product_id,
      cl.canonical_unit_id,
      ABS(COALESCE(real_ship.real_debited, 0) - ll.received_quantity)
    )).supplier_unit_id   AS supplier_unit_id,
    (fn_convert_b2b_quantity(
      bip.source_product_id,
      cl.canonical_unit_id,
      ABS(COALESCE(real_ship.real_debited, 0) - ll.received_quantity)
    )).supplier_quantity  AS supplier_abs_quantity,
    (fn_convert_b2b_quantity(
      bip.source_product_id,
      cl.canonical_unit_id,
      ABS(COALESCE(real_ship.real_debited, 0) - ll.received_quantity)
    )).supplier_family    AS supplier_family,
    (fn_convert_b2b_quantity(
      bip.source_product_id,
      cl.canonical_unit_id,
      ABS(COALESCE(real_ship.real_debited, 0) - ll.received_quantity)
    )).status             AS conversion_status,
    CASE WHEN (COALESCE(real_ship.real_debited, 0) - ll.received_quantity) >= 0 THEN 1 ELSE -1 END AS delta_sign
  FROM litige_lines ll
  JOIN commande_lines cl ON cl.id = ll.commande_line_id
  -- Get real stock debited from stock_events for this shipment
  LEFT JOIN LATERAL (
    SELECT SUM(ABS(se.delta_quantity_canonical)) AS real_debited
    FROM stock_events se
    JOIN stock_documents sd ON sd.id = se.document_id
    JOIN stock_document_lines sdl ON sdl.document_id = sd.id AND sdl.product_id = se.product_id
    WHERE sd.source_order_id = v_commande.id
      AND sd.type = 'WITHDRAWAL'
      AND se.event_reason = 'B2B_SHIPMENT'
      AND sdl.source_line_id = cl.id
  ) real_ship ON true
  JOIN b2b_imported_products bip
    ON bip.local_product_id = cl.product_id
    AND bip.establishment_id = v_commande.client_establishment_id
    AND bip.source_establishment_id = v_commande.supplier_establishment_id
  JOIN products_v2 sp ON sp.id = bip.source_product_id
  WHERE ll.litige_id = p_litige_id
    AND ll.shipped_quantity != ll.received_quantity
    AND bip.source_product_id IS NOT NULL
    AND sp.storage_zone_id IS NOT NULL
  ORDER BY ll.id, bip.imported_at DESC;

  -- Remove lines with zero real_delta (no correction needed)
  DELETE FROM _litige_adj_lines WHERE real_delta = 0;

  -- Hard block: conversion errors
  SELECT count(*) INTO v_conversion_error_count
  FROM _litige_adj_lines WHERE conversion_status = 'error';

  DELETE FROM _litige_adj_lines WHERE conversion_status = 'error';

  v_idemp_key := 'litige_resolve:' || p_litige_id::text;

  FOR v_zone_id IN SELECT DISTINCT supplier_zone_id FROM _litige_adj_lines
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM zone_stock_snapshots
      WHERE establishment_id = v_commande.supplier_establishment_id AND storage_zone_id = v_zone_id
    ) THEN CONTINUE; END IF;

    v_doc_id := NULL;
    INSERT INTO stock_documents (
      establishment_id, organization_id, storage_zone_id,
      type, status, created_by, idempotency_key
    ) VALUES (
      v_commande.supplier_establishment_id, v_org_id, v_zone_id,
      'ADJUSTMENT', 'DRAFT', p_user_id,
      v_idemp_key || ':' || v_zone_id::text
    )
    ON CONFLICT (establishment_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_doc_id;

    IF v_doc_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO stock_document_lines (
      document_id, product_id,
      delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label, context_hash
    )
    SELECT v_doc_id,
      al.supplier_product_id,
      al.delta_sign * al.supplier_abs_quantity,
      al.supplier_unit_id,
      COALESCE(al.supplier_family, 'unit'),
      COALESCE(mu.name, ''),
      'auto:litige:' || al.supplier_product_id::text || ':' || al.supplier_unit_id::text || ':' || COALESCE(al.supplier_family, 'unit')
    FROM _litige_adj_lines al
    LEFT JOIN measurement_units mu ON mu.id = al.supplier_unit_id
    WHERE al.supplier_zone_id = v_zone_id;

    SELECT public.fn_post_stock_document(
      p_document_id := v_doc_id,
      p_expected_lock_version := 1,
      p_posted_by := p_user_id,
      p_idempotency_key := v_idemp_key || ':' || v_zone_id::text,
      p_event_reason := 'LITIGE_CORRECTION'
    ) INTO v_post_result;

    IF NOT (v_post_result->>'ok')::boolean THEN
      RAISE EXCEPTION 'Stock post failed for litige resolve: %', v_post_result::text;
    END IF;

    v_adjusted_count := v_adjusted_count + (SELECT count(*) FROM _litige_adj_lines WHERE supplier_zone_id = v_zone_id);
  END LOOP;

  UPDATE litiges SET status = 'resolved', resolved_by = p_user_id, resolved_at = now()
  WHERE id = p_litige_id;

  UPDATE commandes SET status = 'recue', updated_at = now()
  WHERE id = v_litige.commande_id;

  RETURN jsonb_build_object('ok', true, 'adjusted_lines', v_adjusted_count, 'conversion_errors', v_conversion_error_count);
END;
$function$;
