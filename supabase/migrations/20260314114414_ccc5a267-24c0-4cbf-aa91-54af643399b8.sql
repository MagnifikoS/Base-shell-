
-- C2: Fix fn_initialize_product_stock — use COALESCE(stock_handling_unit_id, final_unit_id)
-- C3: Fix fn_import_b2b_product_atomic — call stock init in UPDATE path too

-- ═══════════════════════════════════════════════════════════════
-- C2: fn_initialize_product_stock — fallback to final_unit_id
-- ═══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.fn_initialize_product_stock(uuid, uuid, numeric);

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
  SELECT id, storage_zone_id, stock_handling_unit_id, final_unit_id, establishment_id
  INTO v_product
  FROM products_v2
  WHERE id = p_product_id AND archived_at IS NULL;

  IF v_product IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;

  IF v_product.storage_zone_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PRODUCT_NO_ZONE');
  END IF;

  -- C2 FIX: fallback to final_unit_id when stock_handling_unit_id is null
  v_canonical_unit_id := COALESCE(v_product.stock_handling_unit_id, v_product.final_unit_id);

  IF v_canonical_unit_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PRODUCT_NO_UNIT');
  END IF;

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
      organization_id, establishment_id, storage_zone_id, status,
      started_at, completed_at, started_by, total_products, counted_products
    ) VALUES (
      v_org_id, v_product.establishment_id, v_product.storage_zone_id, 'termine',
      now(), now(), p_user_id, 0, 0
    ) RETURNING id INTO v_bootstrap_session_id;

    INSERT INTO zone_stock_snapshots (
      establishment_id, organization_id, storage_zone_id,
      snapshot_version_id, activated_at, activated_by
    ) VALUES (
      v_product.establishment_id, v_org_id, v_product.storage_zone_id,
      v_bootstrap_session_id, now(), p_user_id
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
        session_id, product_id, quantity, unit_id,
        counted_at, counted_by, created_via
      ) VALUES (
        v_snapshot.snapshot_version_id, p_product_id, v_qty, v_canonical_unit_id,
        now(), p_user_id, 'INIT_AFTER_SNAPSHOT'
      );

      RETURN jsonb_build_object(
        'ok', true, 'product_id', p_product_id,
        'snapshot_version_id', v_snapshot.snapshot_version_id,
        'unit_corrected', true, 'bootstrapped', false,
        'initial_quantity', v_qty,
        'message', 'Unité corrigée et stock initialisé.'
      );
    END IF;

    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'message', 'Produit déjà initialisé.');
  END IF;

  -- 4. Insert inventory line with initial quantity
  INSERT INTO inventory_lines (
    session_id, product_id, quantity, unit_id,
    counted_at, counted_by, created_via
  ) VALUES (
    v_snapshot.snapshot_version_id, p_product_id, v_qty, v_canonical_unit_id,
    now(), p_user_id, 'INIT_AFTER_SNAPSHOT'
  );

  RETURN jsonb_build_object(
    'ok', true, 'product_id', p_product_id,
    'snapshot_version_id', v_snapshot.snapshot_version_id,
    'bootstrapped', true, 'initial_quantity', v_qty,
    'message', 'Stock initialisé (snapshot bootstrap créé si nécessaire).'
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- C3: fn_import_b2b_product_atomic — add stock init to UPDATE path
-- + C4: fallback stock_handling_unit_id to final_unit_id
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_import_b2b_product_atomic(
  p_establishment_id uuid,
  p_user_id uuid,
  p_nom_produit text,
  p_name_normalized text,
  p_code_produit text,
  p_category text,
  p_category_id uuid,
  p_supplier_id uuid,
  p_final_unit_id uuid,
  p_supplier_billing_unit_id uuid,
  p_delivery_unit_id uuid,
  p_stock_handling_unit_id uuid,
  p_kitchen_unit_id uuid,
  p_price_display_unit_id uuid,
  p_min_stock_unit_id uuid,
  p_final_unit_price numeric,
  p_conditionnement_config jsonb,
  p_conditionnement_resume text,
  p_min_stock_quantity_canonical numeric,
  p_storage_zone_id uuid,
  p_source_product_id uuid,
  p_source_establishment_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
  v_code_match_id UUID;
  v_name_match_id UUID;
  v_existing_id UUID;
  v_init_result JSONB;
  v_clean_code TEXT;
  v_effective_stock_unit UUID;
BEGIN
  -- 1. Verify caller belongs to establishment
  IF NOT EXISTS (
    SELECT 1 FROM get_user_establishment_ids() AS eid
    WHERE eid = p_establishment_id
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- C4: Ensure stock_handling_unit_id is never null when final_unit_id is available
  v_effective_stock_unit := COALESCE(p_stock_handling_unit_id, p_final_unit_id);

  -- 2. Clean orphaned tracking from previously deleted products
  DELETE FROM b2b_imported_products
  WHERE establishment_id = p_establishment_id
    AND source_product_id = p_source_product_id
    AND source_establishment_id = p_source_establishment_id;

  -- 3. Normalize code_produit
  v_clean_code := NULLIF(TRIM(COALESCE(p_code_produit, '')), '');
  IF v_clean_code IS NOT NULL AND lower(v_clean_code) = 'null' THEN
    v_clean_code := NULL;
  END IF;

  -- 4. P1: Match by code_produit
  IF v_clean_code IS NOT NULL THEN
    SELECT id INTO v_code_match_id
    FROM products_v2
    WHERE establishment_id = p_establishment_id
      AND code_produit = v_clean_code
      AND archived_at IS NULL
    LIMIT 1;
  END IF;

  -- 5. P2: Match by supplier_id + name_normalized
  SELECT id INTO v_name_match_id
  FROM products_v2
  WHERE establishment_id = p_establishment_id
    AND supplier_id = p_supplier_id
    AND name_normalized = p_name_normalized
    AND archived_at IS NULL
  LIMIT 1;

  -- 6. Ambiguity check
  IF v_code_match_id IS NOT NULL 
     AND v_name_match_id IS NOT NULL 
     AND v_code_match_id != v_name_match_id THEN
    RAISE EXCEPTION 'AMBIGUOUS_IDENTITY:code=% matches product %, but name=% matches product %',
      v_clean_code, v_code_match_id, p_name_normalized, v_name_match_id;
  END IF;

  -- 7. Resolve: P1 wins, then P2, then INSERT
  v_existing_id := COALESCE(v_code_match_id, v_name_match_id);

  IF v_existing_id IS NOT NULL THEN
    UPDATE products_v2 SET
      nom_produit = p_nom_produit,
      name_normalized = p_name_normalized,
      code_produit = COALESCE(v_clean_code, code_produit),
      category_id = COALESCE(p_category_id, category_id),
      final_unit_id = p_final_unit_id,
      supplier_billing_unit_id = p_supplier_billing_unit_id,
      delivery_unit_id = p_delivery_unit_id,
      stock_handling_unit_id = v_effective_stock_unit,
      kitchen_unit_id = p_kitchen_unit_id,
      price_display_unit_id = p_price_display_unit_id,
      min_stock_unit_id = p_min_stock_unit_id,
      final_unit_price = p_final_unit_price,
      conditionnement_config = p_conditionnement_config,
      conditionnement_resume = p_conditionnement_resume,
      storage_zone_id = COALESCE(p_storage_zone_id, storage_zone_id),
      updated_at = now()
    WHERE id = v_existing_id;

    v_product_id := v_existing_id;

    INSERT INTO inventory_zone_products (
      establishment_id, product_id, storage_zone_id, display_order
    ) VALUES (
      p_establishment_id, v_product_id, p_storage_zone_id, 0
    ) ON CONFLICT DO NOTHING;

    -- C3 FIX: Initialize stock for existing products too
    v_init_result := fn_initialize_product_stock(v_product_id, p_user_id, 0);
    -- Non-blocking: if already initialized, fn returns idempotent=true

  ELSE
    INSERT INTO products_v2 (
      establishment_id, nom_produit, name_normalized,
      code_produit, category, category_id, supplier_id, final_unit_id,
      supplier_billing_unit_id, delivery_unit_id, stock_handling_unit_id,
      kitchen_unit_id, price_display_unit_id, min_stock_unit_id,
      final_unit_price, conditionnement_config, conditionnement_resume,
      min_stock_quantity_canonical, storage_zone_id,
      created_by
    ) VALUES (
      p_establishment_id, p_nom_produit, p_name_normalized,
      v_clean_code, p_category, p_category_id, p_supplier_id, p_final_unit_id,
      p_supplier_billing_unit_id, p_delivery_unit_id, v_effective_stock_unit,
      p_kitchen_unit_id, p_price_display_unit_id, p_min_stock_unit_id,
      p_final_unit_price, p_conditionnement_config, p_conditionnement_resume,
      p_min_stock_quantity_canonical, p_storage_zone_id,
      p_user_id
    ) RETURNING id INTO v_product_id;

    INSERT INTO inventory_zone_products (
      establishment_id, product_id, storage_zone_id, display_order
    ) VALUES (
      p_establishment_id, v_product_id, p_storage_zone_id, 0
    );

    v_init_result := fn_initialize_product_stock(v_product_id, p_user_id, 0);
    IF NOT COALESCE((v_init_result->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'STOCK_INIT_FAILED: %', v_init_result->>'error';
    END IF;
  END IF;

  INSERT INTO b2b_imported_products (
    establishment_id, source_product_id, source_establishment_id,
    local_product_id, imported_by
  ) VALUES (
    p_establishment_id, p_source_product_id, p_source_establishment_id,
    v_product_id, p_user_id
  ) ON CONFLICT DO NOTHING;

  RETURN v_product_id;
END;
$$;
