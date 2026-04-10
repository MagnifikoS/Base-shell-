
-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: fn_initialize_product_stock — handle unit_id drift
-- When a product is reconfigured (unit changed), the existing inventory_line
-- may have a stale unit_id causing FAMILY_MISMATCH. The RPC now updates it.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_initialize_product_stock(
  p_product_id UUID,
  p_user_id UUID,
  p_target_quantity NUMERIC DEFAULT 0  -- kept for backward compat, IGNORED
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_snapshot RECORD;
  v_existing_line RECORD;
  v_line_id UUID;
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
    RETURN jsonb_build_object('ok', false, 'error', 'MISSING_ZONE');
  END IF;

  IF v_product.stock_handling_unit_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MISSING_STOCK_UNIT');
  END IF;

  v_canonical_unit_id := v_product.stock_handling_unit_id;

  -- ═══ 2. Fetch active snapshot for zone ═══
  SELECT id, snapshot_version_id
  INTO v_snapshot
  FROM zone_stock_snapshots
  WHERE establishment_id = v_product.establishment_id
    AND storage_zone_id = v_product.storage_zone_id;

  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SNAPSHOT');
  END IF;

  -- ═══ 3. Check existing line ═══
  SELECT id, unit_id INTO v_existing_line
  FROM inventory_lines
  WHERE session_id = v_snapshot.snapshot_version_id
    AND product_id = p_product_id
  LIMIT 1;

  IF v_existing_line.id IS NOT NULL THEN
    -- Line exists — check if unit_id matches current config
    IF v_existing_line.unit_id IS DISTINCT FROM v_canonical_unit_id THEN
      -- Unit drift: product was reconfigured after the inventory.
      -- Update the line's unit_id and reset quantity to 0 to avoid FAMILY_MISMATCH.
      UPDATE inventory_lines
      SET unit_id = v_canonical_unit_id,
          quantity = 0,
          counted_by = p_user_id,
          counted_at = now(),
          created_via = 'INIT_AFTER_SNAPSHOT'
      WHERE id = v_existing_line.id;

      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', false,
        'unit_corrected', true,
        'message', 'Ligne existante corrigée (unité mise à jour).',
        'snapshot_version_id', v_snapshot.snapshot_version_id
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'message', 'Produit déjà initialisé',
      'snapshot_version_id', v_snapshot.snapshot_version_id
    );
  END IF;

  -- ═══ 4. Insert inventory_line qty=0 ═══
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

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'message', 'Produit initialisé (stock = 0). Utilisez Modifier pour définir le stock réel.',
    'snapshot_version_id', v_snapshot.snapshot_version_id,
    'inventory_line_id', v_line_id
  );
END;
$function$;
