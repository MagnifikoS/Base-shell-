
-- Fix fn_initialize_product_stock: products_v2 has no organization_id column.
-- Get it from establishments table instead.
CREATE OR REPLACE FUNCTION public.fn_initialize_product_stock(
  p_product_id UUID,
  p_user_id UUID,
  p_target_quantity NUMERIC DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_org_id UUID;
  v_snapshot RECORD;
  v_existing_line_id UUID;
  v_line_id UUID;
  v_doc_id UUID;
  v_event_id UUID;
  v_canonical_unit_id UUID;
  v_canonical_family TEXT;
  v_canonical_label TEXT;
BEGIN
  -- ═══ 0. Validate target quantity ═══
  IF p_target_quantity < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NEGATIVE_QUANTITY');
  END IF;

  -- ═══ 1. Fetch product (no organization_id on products_v2) ═══
  SELECT id, storage_zone_id, stock_handling_unit_id, establishment_id
  INTO v_product
  FROM products_v2
  WHERE id = p_product_id AND archived_at IS NULL;

  IF v_product IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;

  IF v_product.storage_zone_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MISSING_ZONE');
  END IF;

  IF v_product.stock_handling_unit_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MISSING_STOCK_UNIT');
  END IF;

  -- ═══ 1b. Get organization_id from establishment ═══
  SELECT organization_id INTO v_org_id
  FROM establishments
  WHERE id = v_product.establishment_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ESTABLISHMENT_NOT_FOUND');
  END IF;

  -- ═══ 2. Resolve canonical unit ═══
  v_canonical_unit_id := v_product.stock_handling_unit_id;

  SELECT family, name INTO v_canonical_family, v_canonical_label
  FROM measurement_units
  WHERE id = v_canonical_unit_id;

  IF v_canonical_family IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNIT_NOT_FOUND');
  END IF;

  -- ═══ 3. Fetch active snapshot for zone ═══
  SELECT id, snapshot_version_id
  INTO v_snapshot
  FROM zone_stock_snapshots
  WHERE establishment_id = v_product.establishment_id
    AND storage_zone_id = v_product.storage_zone_id;

  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SNAPSHOT');
  END IF;

  -- ═══ 4. Idempotency: check if inventory_line already exists ═══
  SELECT id INTO v_existing_line_id
  FROM inventory_lines
  WHERE session_id = v_snapshot.snapshot_version_id
    AND product_id = p_product_id
  LIMIT 1;

  IF v_existing_line_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'message', 'Ligne déjà existante',
      'snapshot_version_id', v_snapshot.snapshot_version_id
    );
  END IF;

  -- ═══ 5. Insert inventory_line qty=0 (SSOT snapshot reference) ═══
  INSERT INTO inventory_lines (
    session_id, product_id, quantity, unit_id,
    created_via, counted_by, counted_at
  ) VALUES (
    v_snapshot.snapshot_version_id,
    p_product_id,
    0,
    v_canonical_unit_id,
    'INIT_AFTER_SNAPSHOT',
    p_user_id,
    now()
  ) RETURNING id INTO v_line_id;

  -- ═══ 6. Create INITIAL_STOCK document + event if target > 0 ═══
  IF p_target_quantity > 0 THEN
    INSERT INTO stock_documents (
      establishment_id, organization_id, storage_zone_id,
      type, status,
      created_by, posted_by, posted_at
    ) VALUES (
      v_product.establishment_id,
      v_org_id,
      v_product.storage_zone_id,
      'INITIAL_STOCK',
      'POSTED',
      p_user_id,
      p_user_id,
      now()
    ) RETURNING id INTO v_doc_id;

    INSERT INTO stock_events (
      establishment_id, organization_id, storage_zone_id, product_id,
      document_id, event_type, event_reason,
      delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label,
      context_hash, snapshot_version_id,
      override_flag, override_reason, posted_by
    ) VALUES (
      v_product.establishment_id,
      v_org_id,
      v_product.storage_zone_id,
      p_product_id,
      v_doc_id,
      'INITIAL_STOCK',
      'Stock initial après inventaire',
      ROUND(p_target_quantity, 4),
      v_canonical_unit_id,
      v_canonical_family,
      v_canonical_label,
      md5(v_canonical_unit_id::text || '|' || v_canonical_family),
      v_snapshot.snapshot_version_id,
      false,
      NULL,
      p_user_id
    ) RETURNING id INTO v_event_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'message', 'Stock initialisé',
    'snapshot_version_id', v_snapshot.snapshot_version_id,
    'inventory_line_id', v_line_id,
    'document_id', COALESCE(v_doc_id, NULL),
    'event_id', COALESCE(v_event_id, NULL),
    'target_quantity', p_target_quantity
  );
END;
$function$;
