
-- ═══════════════════════════════════════════════════════════════
-- FIX: Add received_quantity validation to fn_receive_commande
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_receive_commande(
  p_commande_id uuid,
  p_lines jsonb,
  p_user_id uuid
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
  v_doc_id uuid;
  v_post_result jsonb;
  v_idemp_key text;
  v_client_est record;
  v_org_id uuid;
  v_zone_id uuid;
  v_total_lines int;
BEGIN
  -- ═══ 0. Lock commande ═══
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

  -- ═══ 1. Validate input lines BEFORE any mutation ═══
  -- 1a. Check all commande lines are covered
  SELECT count(*) INTO v_total_lines
  FROM commande_lines WHERE commande_id = p_commande_id;

  IF jsonb_array_length(p_lines) != v_total_lines THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lines_count_mismatch',
      'expected', v_total_lines, 'received', jsonb_array_length(p_lines));
  END IF;

  -- 1b. Validate each line's received_quantity
  FOR v_line_input IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    -- Check received_quantity is present and not null
    IF v_line_input->>'received_quantity' IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'received_quantity_null',
        'line_id', v_line_input->>'line_id');
    END IF;

    -- Check not negative
    IF (v_line_input->>'received_quantity')::numeric < 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'received_quantity_negative',
        'line_id', v_line_input->>'line_id');
    END IF;

    -- Check not exceeding shipped_quantity
    IF EXISTS (
      SELECT 1 FROM commande_lines
      WHERE id = (v_line_input->>'line_id')::uuid
        AND commande_id = p_commande_id
        AND COALESCE(shipped_quantity, 0) < (v_line_input->>'received_quantity')::numeric
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'received_exceeds_shipped',
        'line_id', v_line_input->>'line_id');
    END IF;
  END LOOP;

  -- ═══ 2. Update lines with validated received quantities ═══
  FOR v_line_input IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    UPDATE commande_lines
    SET received_quantity = (v_line_input->>'received_quantity')::numeric
    WHERE id = (v_line_input->>'line_id')::uuid
      AND commande_id = p_commande_id;

    v_line_count := v_line_count + 1;
  END LOOP;

  -- ═══ 3. Determine reception type ═══
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

  -- ═══ 4. Update commande status ═══
  UPDATE commandes
  SET status = 'recue',
      received_by = p_user_id::text,
      received_at = now(),
      reception_type = CASE WHEN v_is_complete THEN 'complete' ELSE 'partielle' END,
      updated_at = now()
  WHERE id = p_commande_id;

  -- ═══ 5. Stock ledger — RECEIPT to client ═══
  SELECT e.id, e.organization_id INTO v_client_est
  FROM establishments e
  WHERE e.id = v_commande.client_establishment_id;

  IF v_client_est IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'client_establishment_not_found');
  END IF;

  v_org_id := v_client_est.organization_id;
  v_idemp_key := 'receive:' || p_commande_id::text;

  CREATE TEMP TABLE _recv_lines ON COMMIT DROP AS
  SELECT
    cl.id as line_id,
    cl.product_id as client_product_id,
    COALESCE(cl.received_quantity, 0) as received_qty,
    cl.canonical_unit_id,
    cp.storage_zone_id as client_zone_id,
    cp.nom_produit as client_product_name,
    mu.family as canonical_family,
    mu.name as canonical_label
  FROM commande_lines cl
  JOIN products_v2 cp ON cp.id = cl.product_id
  LEFT JOIN measurement_units mu ON mu.id = cl.canonical_unit_id
  WHERE cl.commande_id = p_commande_id
    AND COALESCE(cl.received_quantity, 0) > 0;

  IF EXISTS (SELECT 1 FROM _recv_lines) THEN
    FOR v_zone_id IN SELECT DISTINCT client_zone_id FROM _recv_lines WHERE client_zone_id IS NOT NULL
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM zone_stock_snapshots
        WHERE establishment_id = v_commande.client_establishment_id
          AND storage_zone_id = v_zone_id
      ) THEN
        CONTINUE;
      END IF;

      v_doc_id := gen_random_uuid();

      INSERT INTO stock_documents (
        id, establishment_id, organization_id, storage_zone_id,
        type, status, created_by, idempotency_key, source_order_id
      ) VALUES (
        v_doc_id, v_commande.client_establishment_id, v_org_id, v_zone_id,
        'RECEIPT', 'DRAFT', p_user_id, v_idemp_key || ':' || v_zone_id::text,
        p_commande_id
      );

      INSERT INTO stock_document_lines (
        document_id, product_id,
        delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label,
        context_hash
      )
      SELECT
        v_doc_id,
        rl.client_product_id,
        rl.received_qty,
        rl.canonical_unit_id,
        rl.canonical_family,
        rl.canonical_label,
        'auto:' || rl.client_product_id::text || ':' || rl.canonical_unit_id::text || ':' || COALESCE(rl.canonical_family, 'null')
      FROM _recv_lines rl
      WHERE rl.client_zone_id = v_zone_id;

      SELECT public.fn_post_stock_document(
        p_document_id := v_doc_id,
        p_expected_lock_version := 1,
        p_posted_by := p_user_id,
        p_idempotency_key := v_idemp_key || ':' || v_zone_id::text,
        p_event_reason := 'B2B_RECEPTION',
        p_override_flag := false
      ) INTO v_post_result;

      IF NOT (v_post_result->>'ok')::boolean THEN
        RAISE EXCEPTION 'Stock post failed for receive: %', v_post_result::text;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'line_count', v_line_count,
    'reception_type', CASE WHEN v_is_complete THEN 'complete' ELSE 'partielle' END
  );
END;
$$;
