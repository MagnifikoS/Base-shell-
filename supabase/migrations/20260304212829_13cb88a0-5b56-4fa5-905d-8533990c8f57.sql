
-- ═══════════════════════════════════════════════════════════════════════════
-- FIX B-01: fn_resolve_litige → use Ledger standard (stock_document_lines + fn_post_stock_document)
--
-- BEFORE: Direct INSERT INTO stock_events + manual UPDATE stock_documents SET status = 'POSTED'
-- AFTER:  INSERT INTO stock_document_lines + SELECT fn_post_stock_document(...)
--
-- Pattern aligned with fn_ship_commande / fn_receive_commande
-- Grouping: 1 ADJUSTMENT document per zone (not per line)
-- ═══════════════════════════════════════════════════════════════════════════

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
BEGIN
  -- ═══ 0. Lock litige ═══
  SELECT * INTO v_litige FROM litiges WHERE id = p_litige_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'litige_not_found');
  END IF;
  IF v_litige.status != 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_resolved');
  END IF;

  -- ═══ 1. Lock commande ═══
  SELECT * INTO v_commande FROM commandes WHERE id = v_litige.commande_id FOR UPDATE;
  IF v_commande.status != 'litige' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_commande_status');
  END IF;

  -- ═══ 2. Verify caller is supplier member ═══
  IF NOT EXISTS (
    SELECT 1 FROM user_establishments
    WHERE user_id = p_user_id AND establishment_id = v_commande.supplier_establishment_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'access_denied');
  END IF;

  -- ═══ 3. Get supplier org ═══
  SELECT organization_id INTO v_org_id
  FROM establishments WHERE id = v_commande.supplier_establishment_id;

  -- ═══ 4. Build temp table of lines with positive delta (stock return to FO) ═══
  CREATE TEMP TABLE _litige_adj_lines ON COMMIT DROP AS
  SELECT
    ll.id AS ll_id,
    ll.commande_line_id,
    ll.shipped_quantity - ll.received_quantity AS delta,
    cl.canonical_unit_id,
    bip.source_product_id AS supplier_product_id,
    sp.storage_zone_id AS supplier_zone_id,
    mu.family AS canonical_family,
    mu.name AS canonical_label
  FROM litige_lines ll
  JOIN commande_lines cl ON cl.id = ll.commande_line_id
  JOIN b2b_imported_products bip
    ON bip.local_product_id = cl.product_id
    AND bip.establishment_id = v_commande.client_establishment_id
    AND bip.source_establishment_id = v_commande.supplier_establishment_id
  JOIN products_v2 sp ON sp.id = bip.source_product_id
  LEFT JOIN measurement_units mu ON mu.id = cl.canonical_unit_id
  WHERE ll.litige_id = p_litige_id
    AND ll.shipped_quantity > ll.received_quantity
    AND bip.source_product_id IS NOT NULL
    AND sp.storage_zone_id IS NOT NULL;

  -- ═══ 5. Process by zone (1 ADJUSTMENT document per zone, like ship/receive) ═══
  v_idemp_key := 'litige_resolve:' || p_litige_id::text;

  FOR v_zone_id IN SELECT DISTINCT supplier_zone_id FROM _litige_adj_lines
  LOOP
    -- Skip zones without active snapshots
    IF NOT EXISTS (
      SELECT 1 FROM zone_stock_snapshots
      WHERE establishment_id = v_commande.supplier_establishment_id
        AND storage_zone_id = v_zone_id
    ) THEN
      CONTINUE;
    END IF;

    -- Create DRAFT stock document (idempotent via ON CONFLICT)
    v_doc_id := NULL;
    INSERT INTO stock_documents (
      establishment_id, organization_id, storage_zone_id,
      type, status, created_by,
      idempotency_key
    ) VALUES (
      v_commande.supplier_establishment_id, v_org_id, v_zone_id,
      'ADJUSTMENT', 'DRAFT', p_user_id,
      v_idemp_key || ':' || v_zone_id::text
    )
    ON CONFLICT (establishment_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_doc_id;

    -- If already exists (idempotent skip), the doc was already posted → skip
    IF v_doc_id IS NULL THEN
      CONTINUE;
    END IF;

    -- ═══ 5b. Insert stock_document_lines (THE FIX: was missing before) ═══
    INSERT INTO stock_document_lines (
      document_id, product_id,
      delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label,
      context_hash
    )
    SELECT
      v_doc_id,
      al.supplier_product_id,
      al.delta,
      al.canonical_unit_id,
      COALESCE(al.canonical_family, 'unit'),
      al.canonical_label,
      'auto:litige:' || al.supplier_product_id::text || ':' || al.canonical_unit_id::text || ':' || COALESCE(al.canonical_family, 'unit')
    FROM _litige_adj_lines al
    WHERE al.supplier_zone_id = v_zone_id;

    -- ═══ 5c. Post via standard Ledger (THE FIX: was bypassed before) ═══
    SELECT public.fn_post_stock_document(
      p_document_id := v_doc_id,
      p_expected_lock_version := 1,
      p_posted_by := p_user_id,
      p_idempotency_key := v_idemp_key || ':' || v_zone_id::text,
      p_event_reason := 'LITIGE_CORRECTION',
      p_override_flag := true,
      p_override_reason := 'Ajustement litige commande ' || v_litige.commande_id::text
    ) INTO v_post_result;

    IF NOT (v_post_result->>'ok')::boolean THEN
      RAISE EXCEPTION 'Stock post failed for litige resolve: %', v_post_result::text;
    END IF;

    v_adjusted_count := v_adjusted_count + (SELECT count(*) FROM _litige_adj_lines WHERE supplier_zone_id = v_zone_id);
  END LOOP;

  -- ═══ 6. Resolve litige ═══
  UPDATE litiges
  SET status = 'resolved', resolved_by = p_user_id, resolved_at = now()
  WHERE id = p_litige_id;

  -- ═══ 7. Move commande to terminal state (recue = terminal per V0 decision) ═══
  UPDATE commandes
  SET status = 'recue', updated_at = now()
  WHERE id = v_litige.commande_id;

  RETURN jsonb_build_object('ok', true, 'adjusted_lines', v_adjusted_count);
END;
$function$;
