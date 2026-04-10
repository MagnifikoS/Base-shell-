
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY: Prevent stock_handling_unit_id mutation when product has stock
-- Rule: Allow change only when current stock = 0
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Helper function to check if product has non-zero stock
CREATE OR REPLACE FUNCTION public.fn_product_has_stock(p_product_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone_id UUID;
  v_est_id UUID;
  v_snapshot_version_id UUID;
  v_snapshot_qty NUMERIC := 0;
  v_delta_sum NUMERIC := 0;
  v_stock NUMERIC;
BEGIN
  -- Get product zone + establishment
  SELECT storage_zone_id, establishment_id INTO v_zone_id, v_est_id
  FROM products_v2 WHERE id = p_product_id;

  -- No zone = no stock = allow
  IF v_zone_id IS NULL OR v_est_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Get active snapshot for the zone
  SELECT snapshot_version_id INTO v_snapshot_version_id
  FROM zone_stock_snapshots
  WHERE establishment_id = v_est_id
    AND storage_zone_id = v_zone_id;

  -- No snapshot = no stock tracking = allow
  IF v_snapshot_version_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Get inventory baseline
  SELECT COALESCE(quantity, 0) INTO v_snapshot_qty
  FROM inventory_lines
  WHERE session_id = v_snapshot_version_id
    AND product_id = p_product_id;

  -- Sum stock_events deltas
  SELECT COALESCE(SUM(delta_quantity_canonical), 0) INTO v_delta_sum
  FROM stock_events
  WHERE product_id = p_product_id
    AND storage_zone_id = v_zone_id
    AND snapshot_version_id = v_snapshot_version_id;

  v_stock := ROUND((v_snapshot_qty + v_delta_sum)::numeric, 4);

  RETURN v_stock != 0;
END;
$$;

-- 2. Trigger function
CREATE OR REPLACE FUNCTION public.trg_guard_stock_unit_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only fire when stock_handling_unit_id actually changes
  IF OLD.stock_handling_unit_id IS NOT DISTINCT FROM NEW.stock_handling_unit_id THEN
    RETURN NEW;
  END IF;

  -- Allow first-time set (NULL → value)
  IF OLD.stock_handling_unit_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if product has stock
  IF fn_product_has_stock(NEW.id) THEN
    RAISE EXCEPTION 'STOCK_UNIT_LOCKED: Impossible de modifier l''unité stock : le produit a encore du stock. Passez d''abord le stock à 0 via inventaire.';
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Create the trigger
DROP TRIGGER IF EXISTS guard_stock_unit_change ON products_v2;
CREATE TRIGGER guard_stock_unit_change
  BEFORE UPDATE OF stock_handling_unit_id ON products_v2
  FOR EACH ROW
  EXECUTE FUNCTION trg_guard_stock_unit_change();

-- 4. Update fn_save_product_wizard to add pre-check before UPDATE
CREATE OR REPLACE FUNCTION public.fn_save_product_wizard(
  p_product_id UUID,
  p_user_id UUID,
  p_nom_produit TEXT,
  p_name_normalized TEXT,
  p_code_produit TEXT,
  p_conditionnement_config JSONB,
  p_conditionnement_resume TEXT,
  p_supplier_billing_unit_id UUID,
  p_final_unit_price NUMERIC,
  p_final_unit_id UUID,
  p_delivery_unit_id UUID,
  p_price_display_unit_id UUID,
  p_stock_handling_unit_id UUID,
  p_kitchen_unit_id UUID,
  p_min_stock_quantity_canonical NUMERIC,
  p_min_stock_unit_id UUID,
  p_category TEXT,
  p_new_zone_id UUID,
  p_old_zone_id UUID,
  p_estimated_qty NUMERIC DEFAULT 0,
  p_canonical_unit_id UUID DEFAULT NULL,
  p_canonical_family TEXT DEFAULT NULL,
  p_context_hash TEXT DEFAULT NULL,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_dlc_warning_days INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_zone_changed BOOLEAN;
  v_zone_result JSONB;
  v_transferred_qty NUMERIC := 0;
  v_resolved_category_id UUID;
  v_resolved_category_name TEXT;
BEGIN
  -- ── 1. Lock + fetch product ──
  SELECT * INTO v_product
  FROM products_v2
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;

  -- ── 2. Optimistic lock check ──
  IF p_expected_updated_at IS NOT NULL AND v_product.updated_at != p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OPTIMISTIC_LOCK_CONFLICT',
      'expected', p_expected_updated_at::text,
      'actual', v_product.updated_at::text);
  END IF;

  -- ── 2b. GUARD: stock_handling_unit_id change with existing stock ──
  IF v_product.stock_handling_unit_id IS NOT NULL
     AND p_stock_handling_unit_id IS NOT NULL
     AND v_product.stock_handling_unit_id != p_stock_handling_unit_id
     AND fn_product_has_stock(p_product_id)
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STOCK_UNIT_LOCKED',
      'message', 'Impossible de modifier l''unité stock : le produit a encore du stock.');
  END IF;

  -- ── 2c. Resolve dual-write: category_id takes priority ──
  IF p_category_id IS NOT NULL THEN
    v_resolved_category_id := p_category_id;
    SELECT name INTO v_resolved_category_name
    FROM product_categories WHERE id = p_category_id;
  ELSE
    v_resolved_category_name := p_category;
    SELECT id INTO v_resolved_category_id
    FROM product_categories
    WHERE establishment_id = v_product.establishment_id
      AND lower(trim(name)) = lower(trim(p_category))
      AND is_archived = false
    LIMIT 1;
  END IF;

  -- ── 3. Determine if zone changed ──
  v_zone_changed := (
    p_new_zone_id IS NOT NULL 
    AND p_old_zone_id IS NOT NULL 
    AND p_new_zone_id != p_old_zone_id
    AND p_new_zone_id != COALESCE(v_product.storage_zone_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

  -- ── 4. Update ALL product fields atomically (including dlc_warning_days) ──
  UPDATE products_v2
  SET
    nom_produit = UPPER(TRIM(p_nom_produit)),
    name_normalized = p_name_normalized,
    code_produit = p_code_produit,
    conditionnement_config = p_conditionnement_config,
    conditionnement_resume = p_conditionnement_resume,
    supplier_billing_unit_id = p_supplier_billing_unit_id,
    final_unit_price = p_final_unit_price,
    final_unit_id = p_final_unit_id,
    delivery_unit_id = p_delivery_unit_id,
    price_display_unit_id = p_price_display_unit_id,
    stock_handling_unit_id = p_stock_handling_unit_id,
    kitchen_unit_id = p_kitchen_unit_id,
    min_stock_quantity_canonical = p_min_stock_quantity_canonical,
    min_stock_unit_id = p_min_stock_unit_id,
    category = v_resolved_category_name,
    category_id = v_resolved_category_id,
    dlc_warning_days = p_dlc_warning_days,
    storage_zone_id = CASE 
      WHEN v_zone_changed THEN v_product.storage_zone_id
      ELSE COALESCE(p_new_zone_id, v_product.storage_zone_id)
    END,
    updated_at = now()
  WHERE id = p_product_id;

  -- ── 5. Zone transfer via SSOT RPC (same transaction!) ──
  IF v_zone_changed THEN
    v_zone_result := fn_transfer_product_zone(
      p_product_id := p_product_id,
      p_new_zone_id := p_new_zone_id,
      p_user_id := p_user_id,
      p_estimated_qty := p_estimated_qty,
      p_canonical_unit_id := p_canonical_unit_id,
      p_canonical_family := p_canonical_family,
      p_context_hash := p_context_hash
    );

    IF NOT (v_zone_result->>'ok')::boolean THEN
      RAISE EXCEPTION 'ZONE_TRANSFER_FAILED: %', v_zone_result->>'error';
    END IF;

    v_transferred_qty := COALESCE((v_zone_result->>'transferred_qty')::numeric, 0);
  END IF;

  -- ── 6. Return structured result ──
  RETURN jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'zone_changed', v_zone_changed,
    'transferred_qty', v_transferred_qty,
    'category_id', v_resolved_category_id,
    'fields_applied', jsonb_build_array(
      'nom_produit', 'code_produit', 'conditionnement_config', 'conditionnement_resume',
      'supplier_billing_unit_id', 'final_unit_price', 'final_unit_id',
      'delivery_unit_id', 'price_display_unit_id', 'stock_handling_unit_id',
      'kitchen_unit_id', 'min_stock_quantity_canonical', 'min_stock_unit_id',
      'category', 'category_id', 'dlc_warning_days', 'storage_zone_id'
    )
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
