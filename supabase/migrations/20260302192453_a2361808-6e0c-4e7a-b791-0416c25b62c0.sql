
-- ═══════════════════════════════════════════════════════════════════════════
-- fn_save_product_wizard — Atomic Wizard save (identity + config + zone transfer)
-- All-or-nothing: one PG transaction wrapping every Wizard field update.
-- If zone changes → delegates to fn_transfer_product_zone logic inline.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_save_product_wizard(
  p_product_id UUID,
  p_user_id UUID,
  -- Identity fields
  p_nom_produit TEXT,
  p_name_normalized TEXT,
  p_code_produit TEXT,
  -- Config fields  
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
  -- Zone transfer (NULL = no change)
  p_new_zone_id UUID,
  p_old_zone_id UUID,
  -- Stock transfer params (only used if zone changes)
  p_estimated_qty NUMERIC DEFAULT 0,
  p_canonical_unit_id UUID DEFAULT NULL,
  p_canonical_family TEXT DEFAULT NULL,
  p_context_hash TEXT DEFAULT NULL,
  -- Optimistic lock
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL
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

  -- ── 3. Determine if zone changed ──
  v_zone_changed := (
    p_new_zone_id IS NOT NULL 
    AND p_old_zone_id IS NOT NULL 
    AND p_new_zone_id != p_old_zone_id
    AND p_new_zone_id != COALESCE(v_product.storage_zone_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

  -- ── 4. Update ALL product fields atomically (EXCLUDING storage_zone_id if zone changes) ──
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
    category = p_category,
    -- storage_zone_id: only set here if zone did NOT change (or no zone transfer needed)
    storage_zone_id = CASE 
      WHEN v_zone_changed THEN v_product.storage_zone_id  -- keep old, RPC will update
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
      -- Raise exception to ROLLBACK the entire transaction (including the UPDATE above)
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
    'fields_applied', jsonb_build_array(
      'nom_produit', 'code_produit', 'conditionnement_config', 'conditionnement_resume',
      'supplier_billing_unit_id', 'final_unit_price', 'final_unit_id',
      'delivery_unit_id', 'price_display_unit_id', 'stock_handling_unit_id',
      'kitchen_unit_id', 'min_stock_quantity_canonical', 'min_stock_unit_id',
      'category', 'storage_zone_id'
    )
  );

EXCEPTION WHEN OTHERS THEN
  -- Entire transaction rolls back: no partial state possible
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
