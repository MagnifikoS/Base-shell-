
CREATE OR REPLACE FUNCTION public.fn_initialize_product_stock(p_product_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_snapshot RECORD;
  v_existing_line RECORD;
  v_canonical_unit_id UUID;
BEGIN
  -- ═══ 1. Fetch product ═══
  SELECT id, storage_zone_id, stock_handling_unit_id, establishment_id
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

  v_canonical_unit_id := v_product.stock_handling_unit_id;

  -- ═══ 2. Find active snapshot for product's zone ═══
  SELECT id, snapshot_version_id, storage_zone_id
  INTO v_snapshot
  FROM zone_stock_snapshots
  WHERE establishment_id = v_product.establishment_id
    AND storage_zone_id = v_product.storage_zone_id;

  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SNAPSHOT');
  END IF;

  -- ═══ 3. Check existing line ═══
  SELECT id, unit_id
  INTO v_existing_line
  FROM inventory_lines
  WHERE session_id = v_snapshot.snapshot_version_id
    AND product_id = p_product_id
  LIMIT 1;

  IF v_existing_line IS NOT NULL THEN
    -- ═══ 3a. Unit drift detection ═══
    IF v_existing_line.unit_id IS DISTINCT FROM v_canonical_unit_id THEN
      -- Delete old line with wrong unit, then re-insert with correct one
      DELETE FROM inventory_lines WHERE id = v_existing_line.id;
      
      INSERT INTO inventory_lines (
        session_id, product_id, quantity, unit_id,
        counted_at, counted_by, created_via
      ) VALUES (
        v_snapshot.snapshot_version_id,
        p_product_id,
        0,
        v_canonical_unit_id,
        now(),
        p_user_id,
        'INIT_AFTER_SNAPSHOT'
      );

      RETURN jsonb_build_object(
        'ok', true,
        'product_id', p_product_id,
        'snapshot_version_id', v_snapshot.snapshot_version_id,
        'unit_corrected', true,
        'message', 'Unité corrigée et stock réinitialisé à 0.'
      );
    END IF;

    -- Same unit, true idempotent
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'message', 'Produit déjà initialisé.');
  END IF;

  -- ═══ 4. Insert inventory_line qty=0 ═══
  INSERT INTO inventory_lines (
    session_id, product_id, quantity, unit_id,
    counted_at, counted_by, created_via
  ) VALUES (
    v_snapshot.snapshot_version_id,
    p_product_id,
    0,
    v_canonical_unit_id,
    now(),
    p_user_id,
    'INIT_AFTER_SNAPSHOT'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'snapshot_version_id', v_snapshot.snapshot_version_id,
    'message', 'Stock initialisé à 0 (ligne snapshot créée).'
  );
END;
$function$;
