
-- ═══════════════════════════════════════════════════════════════════════════
-- fn_initialize_product_stock — Initialize stock for products created after
-- the last inventory. Inserts a zero-quantity inventory_line + a traceable
-- INIT stock_event (delta=0) for full audit trail.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_initialize_product_stock(
  p_product_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_snapshot RECORD;
  v_existing_line_id UUID;
  v_unit_family TEXT;
  v_unit_label TEXT;
  v_context_hash TEXT;
  v_doc_id UUID;
  v_event_count INT;
BEGIN
  -- ═══ 1. Fetch product ═══
  SELECT id, storage_zone_id, stock_handling_unit_id, establishment_id, organization_id
  INTO v_product
  FROM products_v2
  WHERE id = p_product_id AND archived_at IS NULL;

  IF v_product IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;

  IF v_product.storage_zone_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PRODUCT_NO_ZONE');
  END IF;

  IF v_product.stock_handling_unit_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PRODUCT_NO_UNIT');
  END IF;

  -- ═══ 2. Find active snapshot for product's zone ═══
  SELECT id, snapshot_version_id, storage_zone_id
  INTO v_snapshot
  FROM zone_stock_snapshots
  WHERE establishment_id = v_product.establishment_id
    AND storage_zone_id = v_product.storage_zone_id;

  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SNAPSHOT');
  END IF;

  -- ═══ 3. Check if already initialized (idempotent) ═══
  SELECT id INTO v_existing_line_id
  FROM inventory_lines
  WHERE session_id = v_snapshot.snapshot_version_id
    AND product_id = p_product_id
  LIMIT 1;

  IF v_existing_line_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'message', 'Produit déjà initialisé.');
  END IF;

  -- ═══ 4. Resolve unit family ═══
  SELECT family, name || ' (' || abbreviation || ')'
  INTO v_unit_family, v_unit_label
  FROM measurement_units
  WHERE id = v_product.stock_handling_unit_id;

  IF v_unit_family IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNIT_NOT_FOUND');
  END IF;

  -- ═══ 5. Compute context_hash (minimal — init context) ═══
  v_context_hash := md5(v_product.stock_handling_unit_id::text || '|init|' || now()::text);

  -- ═══ 6. Insert inventory_line (qty=0) into active snapshot session ═══
  INSERT INTO inventory_lines (
    session_id, product_id, quantity, unit_id, counted_at, counted_by
  ) VALUES (
    v_snapshot.snapshot_version_id,
    p_product_id,
    0,
    v_product.stock_handling_unit_id,
    now(),
    p_user_id
  );

  -- ═══ 7. Create ADJUSTMENT document (POSTED immediately) for audit trail ═══
  INSERT INTO stock_documents (
    establishment_id, organization_id, storage_zone_id,
    type, status, created_by, posted_by, posted_at
  ) VALUES (
    v_product.establishment_id, v_product.organization_id, v_product.storage_zone_id,
    'ADJUSTMENT', 'POSTED', p_user_id, p_user_id, now()
  ) RETURNING id INTO v_doc_id;

  -- ═══ 8. Insert INIT stock_event (delta=0) for full audit ═══
  INSERT INTO stock_events (
    establishment_id, organization_id, storage_zone_id, product_id,
    document_id, event_type, event_reason,
    delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label,
    context_hash, snapshot_version_id,
    override_flag, override_reason, posted_by
  ) VALUES (
    v_product.establishment_id, v_product.organization_id, v_product.storage_zone_id,
    p_product_id,
    v_doc_id,
    'ADJUSTMENT',
    'STOCK_INIT',
    0,
    v_product.stock_handling_unit_id,
    v_unit_family,
    v_unit_label,
    v_context_hash,
    v_snapshot.snapshot_version_id,
    false,
    NULL,
    p_user_id
  );

  GET DIAGNOSTICS v_event_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'snapshot_version_id', v_snapshot.snapshot_version_id,
    'document_id', v_doc_id,
    'events_created', v_event_count,
    'message', 'Stock initialisé à 0 avec traçabilité complète.'
  );
END;
$function$;
