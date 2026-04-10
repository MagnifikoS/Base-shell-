-- ═══════════════════════════════════════════════════════════════════════════
-- V0+ Surplus: Allow received > shipped + fix fn_resolve_litige for surplus
-- 1. fn_receive_commande: remove received_exceeds_shipped block
-- 2. fn_resolve_litige: handle surplus (negative delta = stock removal from FO)
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ 1. Rewrite fn_receive_commande — allow surplus ═══
CREATE OR REPLACE FUNCTION public.fn_receive_commande(p_commande_id uuid, p_user_id uuid, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commande record;
  v_line_input jsonb;
  v_line_count int := 0;
  v_is_complete boolean := true;
  v_has_ecarts boolean := false;
  v_line record;
  v_doc_id uuid;
  v_post_result jsonb;
  v_idemp_key text;
  v_client_est record;
  v_org_id uuid;
  v_zone_id uuid;
  v_total_lines int;
  v_litige_id uuid;
  v_missing_zone_products text[];
BEGIN
  SELECT * INTO v_commande FROM commandes WHERE id = p_commande_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'commande_not_found');
  END IF;
  IF v_commande.status != 'expediee' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'current', v_commande.status);
  END IF;

  SELECT count(*) INTO v_total_lines FROM commande_lines WHERE commande_id = p_commande_id;
  IF jsonb_array_length(p_lines) != v_total_lines THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lines_count_mismatch',
      'expected', v_total_lines, 'received', jsonb_array_length(p_lines));
  END IF;

  FOR v_line_input IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    IF v_line_input->>'received_quantity' IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'received_quantity_null',
        'line_id', v_line_input->>'line_id');
    END IF;
    IF (v_line_input->>'received_quantity')::numeric < 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'received_quantity_negative',
        'line_id', v_line_input->>'line_id');
    END IF;
    -- V0+: received > shipped is now ALLOWED (surplus) — écart detection creates litige
  END LOOP;

  SELECT array_agg(cp.nom_produit) INTO v_missing_zone_products
  FROM commande_lines cl
  JOIN products_v2 cp ON cp.id = cl.product_id
  WHERE cl.commande_id = p_commande_id AND cp.storage_zone_id IS NULL;

  IF v_missing_zone_products IS NOT NULL AND array_length(v_missing_zone_products, 1) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_zone',
      'products', to_jsonb(v_missing_zone_products));
  END IF;

  FOR v_line_input IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    UPDATE commande_lines
    SET received_quantity = (v_line_input->>'received_quantity')::numeric
    WHERE id = (v_line_input->>'line_id')::uuid AND commande_id = p_commande_id;
    v_line_count := v_line_count + 1;
  END LOOP;

  FOR v_line IN
    SELECT shipped_quantity, received_quantity FROM commande_lines WHERE commande_id = p_commande_id
  LOOP
    IF COALESCE(v_line.received_quantity, 0) != COALESCE(v_line.shipped_quantity, 0) THEN
      v_is_complete := false;
      v_has_ecarts := true;
      EXIT;
    END IF;
  END LOOP;

  IF v_has_ecarts THEN
    INSERT INTO litiges (commande_id, created_by, status)
    VALUES (p_commande_id, p_user_id, 'open')
    RETURNING id INTO v_litige_id;

    INSERT INTO litige_lines (litige_id, commande_line_id, shipped_quantity, received_quantity)
    SELECT v_litige_id, cl.id, cl.shipped_quantity, cl.received_quantity
    FROM commande_lines cl
    WHERE cl.commande_id = p_commande_id
      AND cl.received_quantity IS NOT NULL AND cl.shipped_quantity IS NOT NULL
      AND cl.received_quantity != cl.shipped_quantity;

    UPDATE commandes
    SET status = 'litige', received_by = p_user_id::text, received_at = now(),
        reception_type = 'partielle', updated_at = now()
    WHERE id = p_commande_id;
  ELSE
    UPDATE commandes
    SET status = 'recue', received_by = p_user_id::text, received_at = now(),
        reception_type = CASE WHEN v_is_complete THEN 'complete' ELSE 'partielle' END,
        updated_at = now()
    WHERE id = p_commande_id;
  END IF;

  SELECT e.id, e.organization_id INTO v_client_est
  FROM establishments e WHERE e.id = v_commande.client_establishment_id;
  IF v_client_est IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'client_establishment_not_found');
  END IF;

  v_org_id := v_client_est.organization_id;
  v_idemp_key := 'receive:' || p_commande_id::text;

  CREATE TEMP TABLE _recv_lines ON COMMIT DROP AS
  SELECT cl.id as line_id, cl.product_id as client_product_id,
    COALESCE(cl.received_quantity, 0) as received_qty, cl.canonical_unit_id,
    cp.storage_zone_id as client_zone_id, cp.nom_produit as client_product_name,
    mu.family as canonical_family, mu.name as canonical_label
  FROM commande_lines cl
  JOIN products_v2 cp ON cp.id = cl.product_id
  LEFT JOIN measurement_units mu ON mu.id = cl.canonical_unit_id
  WHERE cl.commande_id = p_commande_id AND COALESCE(cl.received_quantity, 0) > 0;

  IF EXISTS (SELECT 1 FROM _recv_lines) THEN
    FOR v_zone_id IN SELECT DISTINCT client_zone_id FROM _recv_lines WHERE client_zone_id IS NOT NULL
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM zone_stock_snapshots
        WHERE establishment_id = v_commande.client_establishment_id AND storage_zone_id = v_zone_id
      ) THEN CONTINUE; END IF;

      v_doc_id := gen_random_uuid();
      INSERT INTO stock_documents (id, establishment_id, organization_id, storage_zone_id,
        type, status, created_by, idempotency_key, source_order_id)
      VALUES (v_doc_id, v_commande.client_establishment_id, v_org_id, v_zone_id,
        'RECEIPT', 'DRAFT', p_user_id, v_idemp_key || ':' || v_zone_id::text, p_commande_id);

      INSERT INTO stock_document_lines (document_id, product_id,
        delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label, context_hash)
      SELECT v_doc_id, rl.client_product_id, rl.received_qty, rl.canonical_unit_id,
        rl.canonical_family, rl.canonical_label,
        'auto:' || rl.client_product_id::text || ':' || rl.canonical_unit_id::text || ':' || COALESCE(rl.canonical_family, 'null')
      FROM _recv_lines rl WHERE rl.client_zone_id = v_zone_id;

      SELECT public.fn_post_stock_document(
        p_document_id := v_doc_id, p_expected_lock_version := 1, p_posted_by := p_user_id,
        p_idempotency_key := v_idemp_key || ':' || v_zone_id::text,
        p_event_reason := 'B2B_RECEPTION', p_override_flag := false
      ) INTO v_post_result;

      IF NOT (v_post_result->>'ok')::boolean THEN
        RAISE EXCEPTION 'Stock post failed for receive: %', v_post_result::text;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'line_count', v_line_count,
    'reception_type', CASE WHEN v_has_ecarts THEN 'partielle' ELSE (CASE WHEN v_is_complete THEN 'complete' ELSE 'partielle' END) END,
    'has_litige', v_has_ecarts, 'litige_id', v_litige_id);
END;
$function$;


-- ═══ 2. Rewrite fn_resolve_litige — handle BOTH manquant AND surplus ═══
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

  -- Build temp table with delta for ALL écarts (manquant + surplus)
  -- delta = shipped - received:
  --   positive → manquant (stock returns to FO)
  --   negative → surplus  (stock removed from FO, already shipped physically)
  CREATE TEMP TABLE _litige_adj_lines ON COMMIT DROP AS
  SELECT
    ll.id AS ll_id, ll.commande_line_id,
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
    AND ll.shipped_quantity != ll.received_quantity
    AND bip.source_product_id IS NOT NULL
    AND sp.storage_zone_id IS NOT NULL;

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

    -- delta > 0 (manquant) → positive = stock returns to FO
    -- delta < 0 (surplus) → negative = stock removed from FO
    INSERT INTO stock_document_lines (
      document_id, product_id,
      delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label, context_hash
    )
    SELECT v_doc_id, al.supplier_product_id, al.delta, al.canonical_unit_id,
      COALESCE(al.canonical_family, 'unit'), al.canonical_label,
      'auto:litige:' || al.supplier_product_id::text || ':' || al.canonical_unit_id::text || ':' || COALESCE(al.canonical_family, 'unit')
    FROM _litige_adj_lines al WHERE al.supplier_zone_id = v_zone_id;

    SELECT public.fn_post_stock_document(
      p_document_id := v_doc_id, p_expected_lock_version := 1, p_posted_by := p_user_id,
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

  UPDATE litiges SET status = 'resolved', resolved_by = p_user_id, resolved_at = now()
  WHERE id = p_litige_id;

  UPDATE commandes SET status = 'recue', updated_at = now()
  WHERE id = v_litige.commande_id;

  RETURN jsonb_build_object('ok', true, 'adjusted_lines', v_adjusted_count);
END;
$function$;