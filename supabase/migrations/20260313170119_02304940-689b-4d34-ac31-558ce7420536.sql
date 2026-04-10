-- Restore canonical stock initializer (with optional initial quantity)
-- and keep a single signature to avoid overload ambiguity.
DROP FUNCTION IF EXISTS public.fn_initialize_product_stock(uuid, uuid);

CREATE OR REPLACE FUNCTION public.fn_initialize_product_stock(
  p_product_id UUID,
  p_user_id UUID,
  p_initial_quantity NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_snapshot RECORD;
  v_existing_line RECORD;
  v_canonical_unit_id UUID;
  v_org_id UUID;
  v_bootstrap_session_id UUID;
  v_qty NUMERIC;
BEGIN
  v_qty := COALESCE(p_initial_quantity, 0);

  -- 1. Fetch product
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

  -- 2. Find active snapshot for product's zone
  SELECT id, snapshot_version_id, storage_zone_id
  INTO v_snapshot
  FROM zone_stock_snapshots
  WHERE establishment_id = v_product.establishment_id
    AND storage_zone_id = v_product.storage_zone_id;

  -- 2b. Bootstrap snapshot if none exists
  IF v_snapshot IS NULL THEN
    SELECT organization_id INTO v_org_id
    FROM establishments
    WHERE id = v_product.establishment_id;

    IF v_org_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ESTABLISHMENT_NOT_FOUND');
    END IF;

    INSERT INTO inventory_sessions (
      organization_id,
      establishment_id,
      storage_zone_id,
      status,
      started_at,
      completed_at,
      started_by,
      total_products,
      counted_products
    ) VALUES (
      v_org_id,
      v_product.establishment_id,
      v_product.storage_zone_id,
      'termine',
      now(),
      now(),
      p_user_id,
      0,
      0
    ) RETURNING id INTO v_bootstrap_session_id;

    INSERT INTO zone_stock_snapshots (
      establishment_id,
      organization_id,
      storage_zone_id,
      snapshot_version_id,
      activated_at,
      activated_by
    ) VALUES (
      v_product.establishment_id,
      v_org_id,
      v_product.storage_zone_id,
      v_bootstrap_session_id,
      now(),
      p_user_id
    );

    SELECT id, snapshot_version_id, storage_zone_id
    INTO v_snapshot
    FROM zone_stock_snapshots
    WHERE establishment_id = v_product.establishment_id
      AND storage_zone_id = v_product.storage_zone_id;
  END IF;

  -- 3. Check existing line
  SELECT id, unit_id
  INTO v_existing_line
  FROM inventory_lines
  WHERE session_id = v_snapshot.snapshot_version_id
    AND product_id = p_product_id
  LIMIT 1;

  IF v_existing_line IS NOT NULL THEN
    IF v_existing_line.unit_id IS DISTINCT FROM v_canonical_unit_id THEN
      DELETE FROM inventory_lines WHERE id = v_existing_line.id;

      INSERT INTO inventory_lines (
        session_id,
        product_id,
        quantity,
        unit_id,
        counted_at,
        counted_by,
        created_via
      ) VALUES (
        v_snapshot.snapshot_version_id,
        p_product_id,
        v_qty,
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
        'bootstrapped', false,
        'initial_quantity', v_qty,
        'message', 'Unité corrigée et stock initialisé.'
      );
    END IF;

    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'message', 'Produit déjà initialisé.');
  END IF;

  -- 4. Insert inventory line with initial quantity
  INSERT INTO inventory_lines (
    session_id,
    product_id,
    quantity,
    unit_id,
    counted_at,
    counted_by,
    created_via
  ) VALUES (
    v_snapshot.snapshot_version_id,
    p_product_id,
    v_qty,
    v_canonical_unit_id,
    now(),
    p_user_id,
    'INIT_AFTER_SNAPSHOT'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'snapshot_version_id', v_snapshot.snapshot_version_id,
    'bootstrapped', true,
    'initial_quantity', v_qty,
    'message', 'Stock initialisé (snapshot bootstrap créé si nécessaire).'
  );
END;
$$;