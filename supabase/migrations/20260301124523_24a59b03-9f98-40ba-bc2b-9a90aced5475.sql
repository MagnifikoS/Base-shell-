
-- Fix fn_void_stock_document: Add FOR UPDATE lock to prevent race conditions
-- Must DROP first due to parameter name change (p_void_reason → p_reason)

DROP FUNCTION IF EXISTS public.fn_void_stock_document(UUID, UUID, TEXT);

CREATE FUNCTION public.fn_void_stock_document(
  p_document_id UUID,
  p_voided_by UUID,
  p_reason TEXT DEFAULT 'Annulation'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc RECORD;
  v_void_doc_id UUID;
  v_event RECORD;
  v_inverse_count INT := 0;
  v_snapshot RECORD;
  v_current_qty NUMERIC;
  v_event_delta NUMERIC;
BEGIN
  -- ══ STEP 1: Lock and fetch document (FOR UPDATE prevents concurrent VOIDs) ══
  SELECT *
  INTO v_doc
  FROM stock_documents
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Document introuvable');
  END IF;

  -- ══ STEP 2: Idempotency — already voided ══
  IF v_doc.status = 'VOID' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'detail', 'Document déjà annulé');
  END IF;

  IF v_doc.status != 'POSTED' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Seul un document POSTED peut être annulé (statut actuel: ' || v_doc.status || ')');
  END IF;

  -- ══ STEP 3: Verify snapshots exist for all affected product zones ══
  FOR v_event IN
    SELECT DISTINCT se.storage_zone_id
    FROM stock_events se
    WHERE se.document_id = p_document_id
  LOOP
    SELECT * INTO v_snapshot
    FROM zone_stock_snapshots
    WHERE storage_zone_id = v_event.storage_zone_id
      AND is_active = true;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'Pas de snapshot actif pour la zone ' || v_event.storage_zone_id
      );
    END IF;
  END LOOP;

  -- ══ STEP 4: Negative stock check for RECEIPT voids ══
  IF v_doc.type = 'RECEIPT' THEN
    FOR v_event IN
      SELECT se.product_id, se.storage_zone_id, se.delta_quantity_canonical
      FROM stock_events se
      WHERE se.document_id = p_document_id
    LOOP
      SELECT COALESCE(SUM(se2.delta_quantity_canonical), 0)
      INTO v_current_qty
      FROM stock_events se2
      JOIN stock_documents sd ON sd.id = se2.document_id AND sd.status = 'POSTED'
      WHERE se2.product_id = v_event.product_id
        AND se2.storage_zone_id = v_event.storage_zone_id;

      SELECT COALESCE(il.quantity, 0) INTO v_event_delta
      FROM zone_stock_snapshots zss
      JOIN inventory_sessions isess ON isess.id = zss.snapshot_version_id
      JOIN inventory_lines il ON il.session_id = isess.id AND il.product_id = v_event.product_id
      WHERE zss.storage_zone_id = v_event.storage_zone_id
        AND zss.is_active = true;

      v_current_qty := v_current_qty + COALESCE(v_event_delta, 0);

      IF (v_current_qty - v_event.delta_quantity_canonical) < 0 THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error', 'Annulation impossible : le stock deviendrait négatif pour le produit ' || v_event.product_id
        );
      END IF;
    END LOOP;
  END IF;

  -- ══ STEP 5: Create void document ══
  INSERT INTO stock_documents (
    establishment_id,
    organization_id,
    storage_zone_id,
    type,
    status,
    created_by,
    voids_document_id,
    source_order_id
  ) VALUES (
    v_doc.establishment_id,
    v_doc.organization_id,
    v_doc.storage_zone_id,
    v_doc.type,
    'POSTED',
    p_voided_by,
    p_document_id,
    v_doc.source_order_id
  )
  RETURNING id INTO v_void_doc_id;

  -- ══ STEP 6: Create inverse events ══
  FOR v_event IN
    SELECT *
    FROM stock_events
    WHERE document_id = p_document_id
  LOOP
    INSERT INTO stock_events (
      document_id,
      product_id,
      storage_zone_id,
      delta_quantity_canonical,
      canonical_unit_id,
      canonical_family,
      context_hash
    ) VALUES (
      v_void_doc_id,
      v_event.product_id,
      v_event.storage_zone_id,
      -v_event.delta_quantity_canonical,
      v_event.canonical_unit_id,
      v_event.canonical_family,
      v_event.context_hash
    );
    v_inverse_count := v_inverse_count + 1;
  END LOOP;

  -- ══ STEP 7: Mark original as VOID ══
  UPDATE stock_documents
  SET status = 'VOID',
      updated_at = now()
  WHERE id = p_document_id;

  RETURN jsonb_build_object(
    'ok', true,
    'void_document_id', v_void_doc_id,
    'inverse_events', v_inverse_count,
    'reason', p_reason
  );
END;
$$;

-- Security: only edge functions (service_role) should call this
REVOKE EXECUTE ON FUNCTION public.fn_void_stock_document(UUID, UUID, TEXT) FROM authenticated, anon, public;
