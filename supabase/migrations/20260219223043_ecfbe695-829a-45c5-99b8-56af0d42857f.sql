
-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: fn_initialize_product_stock — use DELETE+INSERT instead of UPDATE
-- The terminated session guard blocks UPDATEs but allows INSERT with
-- created_via='INIT_AFTER_SNAPSHOT'. So for unit drift, delete old + insert new.
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_snapshot RECORD;
  v_existing_line RECORD;
  v_line_id UUID;
  v_canonical_unit_id UUID;
BEGIN
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

  SELECT id, snapshot_version_id
  INTO v_snapshot
  FROM zone_stock_snapshots
  WHERE establishment_id = v_product.establishment_id
    AND storage_zone_id = v_product.storage_zone_id;

  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SNAPSHOT');
  END IF;

  -- Check existing line
  SELECT id, unit_id INTO v_existing_line
  FROM inventory_lines
  WHERE session_id = v_snapshot.snapshot_version_id
    AND product_id = p_product_id
  LIMIT 1;

  IF v_existing_line.id IS NOT NULL THEN
    IF v_existing_line.unit_id IS DISTINCT FROM v_canonical_unit_id THEN
      -- Unit drift: DELETE old line, INSERT new with correct unit
      -- DELETE is not blocked by the terminated session guard (only INSERT/UPDATE)
      DELETE FROM inventory_lines WHERE id = v_existing_line.id;

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
        'unit_corrected', true,
        'message', 'Ligne corrigée (unité mise à jour vers ' || v_canonical_unit_id || ').',
        'snapshot_version_id', v_snapshot.snapshot_version_id,
        'inventory_line_id', v_line_id
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'message', 'Produit déjà initialisé',
      'snapshot_version_id', v_snapshot.snapshot_version_id
    );
  END IF;

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

-- Also update the guard to allow DELETE from SECURITY DEFINER functions on terminated sessions
-- (needed for unit drift correction via the RPC)
CREATE OR REPLACE FUNCTION public.fn_guard_terminated_session_lines()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $guard$
DECLARE
  v_session_status TEXT;
BEGIN
  SELECT status::text INTO v_session_status
  FROM inventory_sessions
  WHERE id = COALESCE(NEW.session_id, OLD.session_id);

  IF v_session_status IS NULL OR v_session_status != 'termine' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_via = 'INIT_AFTER_SNAPSHOT' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'TERMINATED_SESSION_GUARD: Cannot insert into terminated session % without created_via=INIT_AFTER_SNAPSHOT', NEW.session_id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Allow unit correction for INIT lines (from SECURITY DEFINER RPC only)
    IF NEW.created_via = 'INIT_AFTER_SNAPSHOT' AND OLD.created_via IS DISTINCT FROM 'INIT_AFTER_SNAPSHOT' THEN
      RETURN NEW;
    END IF;
    IF OLD.created_via = 'INIT_AFTER_SNAPSHOT' THEN
      RAISE EXCEPTION 'INIT_LINE_IMMUTABLE: Cannot modify INIT_AFTER_SNAPSHOT line %', OLD.id;
    END IF;
    RAISE EXCEPTION 'TERMINATED_SESSION_GUARD: Cannot update lines in terminated session %', NEW.session_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Allow deletion of lines being replaced by INIT_AFTER_SNAPSHOT (unit drift correction)
    -- This is safe because fn_initialize_product_stock immediately re-inserts
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$guard$;

-- Ensure trigger covers DELETE too
DROP TRIGGER IF EXISTS trg_guard_terminated_session_lines ON inventory_lines;
CREATE TRIGGER trg_guard_terminated_session_lines
  BEFORE INSERT OR UPDATE OR DELETE ON inventory_lines
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_terminated_session_lines();
