-- ═══════════════════════════════════════════════════════════════════════════
-- STOCK ZÉRO SIMPLE V2 — Phase 1: Clamp universel dans fn_post_stock_document
--
-- AVANT: Si override_flag=false et stock insuffisant → RAISE EXCEPTION 'NEGATIVE_STOCK'
-- APRÈS: Clamp silencieux — delta sortant réduit à -current_stock si insuffisant
--        Stock final minimum = 0, jamais de blocage, jamais de négatif
--
-- CHANGEMENTS:
--   1. Suppression du bloc NEGATIVE_STOCK (step 9)
--   2. Suppression de la validation OVERRIDE_REASON_REQUIRED (step 7)
--   3. INSERT avec GREATEST(delta, -current_stock) pour les deltas négatifs
--   4. Skip les events à delta effectif = 0
--   5. Retourne clamped_count dans la réponse
--
-- PARAMÈTRES CONSERVÉS (signature inchangée):
--   p_override_flag et p_override_reason restent dans la signature
--   pour compatibilité ascendante avec les appelants existants,
--   mais sont ignorés fonctionnellement.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.fn_post_stock_document(uuid, integer, uuid, text, text, boolean, text);

CREATE OR REPLACE FUNCTION public.fn_post_stock_document(
  p_document_id UUID,
  p_expected_lock_version INT,
  p_posted_by UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_event_reason TEXT DEFAULT NULL,
  p_override_flag BOOLEAN DEFAULT FALSE,
  p_override_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_doc RECORD;
  v_rows_affected INT;
  v_event_count INT;
  v_clamped_count INT := 0;
  v_line_count INT;
  v_incomplete_count INT;
  v_event_reason TEXT;
  v_event_type stock_event_type;
  v_missing_snapshots JSONB;
  v_missing_zone_products JSONB;
  v_warnings JSONB := '[]'::jsonb;
BEGIN
  -- ═══ 0. Fetch document + ROW LOCK ═══
  SELECT * INTO v_doc FROM stock_documents WHERE id = p_document_id FOR UPDATE;
  IF v_doc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DOCUMENT_NOT_FOUND');
  END IF;

  -- ═══ 1. Idempotency ═══
  IF v_doc.status = 'POSTED' AND v_doc.idempotency_key IS NOT NULL 
     AND v_doc.idempotency_key = p_idempotency_key THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'document_id', p_document_id);
  END IF;

  -- ═══ 2. Must be DRAFT ═══
  IF v_doc.status != 'DRAFT' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_DRAFT', 'current_status', v_doc.status::text);
  END IF;

  -- ═══ 3. Resolve event_type AND event_reason ═══
  IF v_doc.type = 'RECEIPT_CORRECTION' THEN
    v_event_type := 'ADJUSTMENT';
    v_event_reason := COALESCE(NULLIF(TRIM(p_event_reason), ''), 'RECEIPT_CORRECTION');
  ELSIF v_doc.type = 'WITHDRAWAL' THEN
    IF p_event_reason IS NULL OR TRIM(p_event_reason) = '' THEN
      RAISE EXCEPTION 'WITHDRAWAL_REASON_REQUIRED: Le motif est obligatoire pour un retrait.';
    END IF;
    v_event_type := 'WITHDRAWAL';
    v_event_reason := TRIM(p_event_reason);
  ELSIF v_doc.type = 'RECEIPT' THEN
    v_event_type := 'RECEIPT';
    v_event_reason := COALESCE(NULLIF(TRIM(p_event_reason), ''), 'RECEIPT');
  ELSIF v_doc.type = 'ADJUSTMENT' THEN
    v_event_type := 'ADJUSTMENT';
    v_event_reason := COALESCE(NULLIF(TRIM(p_event_reason), ''), 'ADJUSTMENT_MANUAL');
  ELSE
    v_event_type := 'ADJUSTMENT';
    v_event_reason := COALESCE(NULLIF(TRIM(p_event_reason), ''), v_doc.type::text);
  END IF;

  -- ═══ 4. Must have lines ═══
  SELECT COUNT(*) INTO v_line_count FROM stock_document_lines WHERE document_id = p_document_id;
  IF v_line_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LINES');
  END IF;

  -- ═══ 5. Line completeness guard ═══
  SELECT COUNT(*) INTO v_incomplete_count
  FROM stock_document_lines
  WHERE document_id = p_document_id
    AND (
      delta_quantity_canonical IS NULL
      OR canonical_unit_id IS NULL
      OR canonical_family IS NULL
      OR context_hash IS NULL
    );

  IF v_incomplete_count > 0 THEN
    RAISE EXCEPTION 'LINE_INCOMPLETE_CANONICAL_DATA: % ligne(s) avec données canoniques manquantes.', v_incomplete_count;
  END IF;

  -- ═══ 6. Per-product snapshot validation + FOR UPDATE lock ═══
  PERFORM zss.id
  FROM stock_document_lines dl
  JOIN products_v2 p ON p.id = dl.product_id
  JOIN zone_stock_snapshots zss 
    ON zss.establishment_id = v_doc.establishment_id
    AND zss.storage_zone_id = COALESCE(p.storage_zone_id, v_doc.storage_zone_id)
  WHERE dl.document_id = p_document_id
  FOR UPDATE OF zss;

  -- Check for lines whose product zone has NO snapshot
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', dl.product_id,
    'product_name', p.nom_produit,
    'zone_id', COALESCE(p.storage_zone_id, v_doc.storage_zone_id)
  )), '[]'::jsonb)
  INTO v_missing_snapshots
  FROM stock_document_lines dl
  JOIN products_v2 p ON p.id = dl.product_id
  LEFT JOIN zone_stock_snapshots zss 
    ON zss.establishment_id = v_doc.establishment_id
    AND zss.storage_zone_id = COALESCE(p.storage_zone_id, v_doc.storage_zone_id)
  WHERE dl.document_id = p_document_id
    AND zss.id IS NULL;

  IF v_missing_snapshots != '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SNAPSHOT',
      'details', v_missing_snapshots);
  END IF;

  -- ═══ 6b. P0 BLOCAGE DUR: Produits sans zone assignée ═══
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', dl.product_id,
    'product_name', p.nom_produit
  )), '[]'::jsonb)
  INTO v_missing_zone_products
  FROM stock_document_lines dl
  JOIN products_v2 p ON p.id = dl.product_id
  WHERE dl.document_id = p_document_id
    AND p.storage_zone_id IS NULL;

  IF v_missing_zone_products != '[]'::jsonb THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'PRODUCT_NO_ZONE',
      'products', v_missing_zone_products,
      'message', 'Produit(s) sans zone de stockage assignée.'
    );
  END IF;

  -- ═══ 6c. RECEIPT/RECEIPT_CORRECTION: generate multi-zone warning ═══
  IF v_doc.type IN ('RECEIPT', 'RECEIPT_CORRECTION') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', dl.product_id,
      'product_name', p.nom_produit,
      'product_zone_id', p.storage_zone_id,
      'product_zone_name', COALESCE(sz.name, p.storage_zone_id::text),
      'document_zone_id', v_doc.storage_zone_id
    )), '[]'::jsonb)
    INTO v_warnings
    FROM stock_document_lines dl
    JOIN products_v2 p ON p.id = dl.product_id
    LEFT JOIN storage_zones sz ON sz.id = p.storage_zone_id
    WHERE dl.document_id = p_document_id
      AND p.storage_zone_id IS NOT NULL
      AND p.storage_zone_id != v_doc.storage_zone_id;
  END IF;

  -- ═══ 7. (REMOVED) Override validation — Stock Zéro Simple V2 ═══
  -- p_override_flag and p_override_reason are kept in signature for backward
  -- compatibility but are functionally ignored. The universal clamp below
  -- handles all cases.

  -- ═══ 8. ATOMIC UPDATE with lock_version check ═══
  UPDATE stock_documents
  SET status = 'POSTED',
      lock_version = lock_version + 1,
      idempotency_key = p_idempotency_key,
      posted_by = p_posted_by,
      posted_at = now(),
      updated_at = now()
  WHERE id = p_document_id
    AND lock_version = p_expected_lock_version
    AND status = 'DRAFT';

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  IF v_rows_affected = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LOCK_CONFLICT',
      'expected_version', p_expected_lock_version,
      'current_version', v_doc.lock_version);
  END IF;

  -- ═══ 9. (REMOVED) Negative stock check — replaced by universal clamp in step 10 ═══
  -- Stock Zéro Simple V2: no blocking, no RAISE EXCEPTION for negative stock.
  -- The clamp is applied directly in the INSERT below.

  -- ═══ 10. INSERT stock_events — WITH UNIVERSAL CLAMP ═══
  -- For outgoing deltas (negative), clamp to -current_stock so stock never goes below 0.
  -- Skip events where effective delta = 0 (nothing to record).
  WITH current_stocks AS (
    -- Compute current stock per product/zone using SSOT formula
    SELECT
      dl.product_id,
      COALESCE(p.storage_zone_id, v_doc.storage_zone_id) AS product_zone_id,
      dl.delta_quantity_canonical AS raw_delta,
      dl.canonical_unit_id,
      dl.canonical_family,
      dl.canonical_label,
      dl.context_hash,
      zss.snapshot_version_id,
      COALESCE(il.quantity, 0) + COALESCE(ev_sum.total_delta, 0) AS current_stock
    FROM stock_document_lines dl
    JOIN products_v2 p ON p.id = dl.product_id
    JOIN zone_stock_snapshots zss 
      ON zss.establishment_id = v_doc.establishment_id
      AND zss.storage_zone_id = COALESCE(p.storage_zone_id, v_doc.storage_zone_id)
    LEFT JOIN inventory_lines il 
      ON il.session_id = zss.snapshot_version_id 
      AND il.product_id = dl.product_id
    LEFT JOIN (
      SELECT se.product_id, se.storage_zone_id, SUM(se.delta_quantity_canonical) AS total_delta
      FROM stock_events se
      JOIN zone_stock_snapshots zss2
        ON zss2.establishment_id = v_doc.establishment_id
        AND zss2.storage_zone_id = se.storage_zone_id
        AND zss2.snapshot_version_id = se.snapshot_version_id
      WHERE se.establishment_id = v_doc.establishment_id
      GROUP BY se.product_id, se.storage_zone_id
    ) ev_sum ON ev_sum.product_id = dl.product_id 
      AND ev_sum.storage_zone_id = COALESCE(p.storage_zone_id, v_doc.storage_zone_id)
    WHERE dl.document_id = p_document_id
  ),
  clamped AS (
    SELECT
      product_id,
      product_zone_id,
      raw_delta,
      current_stock,
      canonical_unit_id,
      canonical_family,
      canonical_label,
      context_hash,
      snapshot_version_id,
      -- Universal clamp: for negative deltas, limit to -current_stock
      CASE
        WHEN raw_delta < 0 THEN GREATEST(raw_delta, -GREATEST(current_stock, 0))
        ELSE raw_delta
      END AS effective_delta,
      -- Track if clamping occurred
      CASE
        WHEN raw_delta < 0 AND raw_delta < -GREATEST(current_stock, 0) THEN true
        ELSE false
      END AS was_clamped
    FROM current_stocks
  )
  INSERT INTO stock_events (
    establishment_id, organization_id, storage_zone_id, product_id,
    document_id, event_type, event_reason,
    delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label,
    context_hash, snapshot_version_id,
    override_flag, override_reason, posted_by
  )
  SELECT
    v_doc.establishment_id,
    v_doc.organization_id,
    c.product_zone_id,
    c.product_id,
    p_document_id,
    v_event_type,
    v_event_reason,
    c.effective_delta,
    c.canonical_unit_id,
    c.canonical_family,
    c.canonical_label,
    c.context_hash,
    c.snapshot_version_id,
    false,  -- override_flag always false (legacy field)
    NULL,   -- override_reason always null (legacy field)
    p_posted_by
  FROM clamped c
  WHERE ROUND(c.effective_delta::numeric, 4) != 0;  -- Skip zero-delta events

  GET DIAGNOSTICS v_event_count = ROW_COUNT;

  -- Count how many lines were clamped
  SELECT COUNT(*) INTO v_clamped_count
  FROM (
    SELECT 1
    FROM stock_document_lines dl
    JOIN products_v2 p ON p.id = dl.product_id
    JOIN zone_stock_snapshots zss 
      ON zss.establishment_id = v_doc.establishment_id
      AND zss.storage_zone_id = COALESCE(p.storage_zone_id, v_doc.storage_zone_id)
    LEFT JOIN inventory_lines il 
      ON il.session_id = zss.snapshot_version_id 
      AND il.product_id = dl.product_id
    LEFT JOIN (
      SELECT se.product_id, se.storage_zone_id, SUM(se.delta_quantity_canonical) AS total_delta
      FROM stock_events se
      JOIN zone_stock_snapshots zss2
        ON zss2.establishment_id = v_doc.establishment_id
        AND zss2.storage_zone_id = se.storage_zone_id
        AND zss2.snapshot_version_id = se.snapshot_version_id
      WHERE se.establishment_id = v_doc.establishment_id
      GROUP BY se.product_id, se.storage_zone_id
    ) ev_sum ON ev_sum.product_id = dl.product_id 
      AND ev_sum.storage_zone_id = COALESCE(p.storage_zone_id, v_doc.storage_zone_id)
    WHERE dl.document_id = p_document_id
      AND dl.delta_quantity_canonical < 0
      AND dl.delta_quantity_canonical < -(GREATEST(COALESCE(il.quantity, 0) + COALESCE(ev_sum.total_delta, 0), 0))
  ) clamped_lines;

  RETURN jsonb_build_object(
    'ok', true,
    'document_id', p_document_id,
    'events_created', v_event_count,
    'clamped_count', v_clamped_count,
    'new_lock_version', p_expected_lock_version + 1,
    'warnings', v_warnings
  );
END;
$function$;

-- Re-apply REVOKE (security: fn_post_stock_document is SECURITY DEFINER, 
-- only callable via edge functions with service_role)
REVOKE EXECUTE ON FUNCTION public.fn_post_stock_document(uuid, integer, uuid, text, text, boolean, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_post_stock_document(uuid, integer, uuid, text, text, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_post_stock_document(uuid, integer, uuid, text, text, boolean, text) FROM public;