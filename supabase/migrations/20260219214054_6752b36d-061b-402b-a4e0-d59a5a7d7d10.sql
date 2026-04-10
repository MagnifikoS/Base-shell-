
-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: Simplify fn_initialize_product_stock + Guard terminated sessions
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Add created_via column to inventory_lines for traceability
ALTER TABLE public.inventory_lines 
ADD COLUMN IF NOT EXISTS created_via TEXT DEFAULT NULL;

COMMENT ON COLUMN public.inventory_lines.created_via IS 
'Traceability: NULL=normal inventory count, INIT_AFTER_SNAPSHOT=product added after snapshot';

-- 2) Simplified RPC: ONLY insert inventory_line (no stock_document, no stock_event)
CREATE OR REPLACE FUNCTION public.fn_initialize_product_stock(p_product_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_snapshot RECORD;
  v_existing_line_id UUID;
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

  -- ═══ 2. Find active snapshot for product's zone ═══
  SELECT id, snapshot_version_id, storage_zone_id
  INTO v_snapshot
  FROM zone_stock_snapshots
  WHERE establishment_id = v_product.establishment_id
    AND storage_zone_id = v_product.storage_zone_id;

  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SNAPSHOT');
  END IF;

  -- ═══ 3. Idempotent: if line already exists → no-op ═══
  SELECT id INTO v_existing_line_id
  FROM inventory_lines
  WHERE session_id = v_snapshot.snapshot_version_id
    AND product_id = p_product_id
  LIMIT 1;

  IF v_existing_line_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'message', 'Produit déjà initialisé.');
  END IF;

  -- ═══ 4. Insert inventory_line qty=0 with traceability ═══
  INSERT INTO inventory_lines (
    session_id, product_id, quantity, unit_id, 
    counted_at, counted_by, created_via
  ) VALUES (
    v_snapshot.snapshot_version_id,
    p_product_id,
    0,
    v_product.stock_handling_unit_id,
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

-- 3) Guard trigger: protect terminated sessions from wild inserts/updates
-- Allow ONLY INIT_AFTER_SNAPSHOT inserts via the RPC (SECURITY DEFINER bypasses this)
-- This trigger blocks direct client-side mutations on terminated session lines
CREATE OR REPLACE FUNCTION public.fn_guard_terminated_session_lines()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_session_status TEXT;
BEGIN
  -- Get session status
  SELECT status::text INTO v_session_status
  FROM inventory_sessions
  WHERE id = NEW.session_id;

  -- Allow all operations on non-terminated sessions
  IF v_session_status IS NULL OR v_session_status != 'termine' THEN
    RETURN NEW;
  END IF;

  -- For terminated sessions:
  IF TG_OP = 'INSERT' THEN
    -- Only allow INIT_AFTER_SNAPSHOT inserts (from the RPC)
    IF NEW.created_via = 'INIT_AFTER_SNAPSHOT' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'TERMINATED_SESSION_GUARD: Cannot insert into terminated session % without created_via=INIT_AFTER_SNAPSHOT', NEW.session_id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Block updates on INIT lines (immutable)
    IF OLD.created_via = 'INIT_AFTER_SNAPSHOT' THEN
      RAISE EXCEPTION 'INIT_LINE_IMMUTABLE: Cannot modify INIT_AFTER_SNAPSHOT line %', OLD.id;
    END IF;
    -- Block updates on regular lines in terminated sessions
    RAISE EXCEPTION 'TERMINATED_SESSION_GUARD: Cannot update lines in terminated session %', NEW.session_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- Apply the guard trigger
DROP TRIGGER IF EXISTS trg_guard_terminated_session_lines ON public.inventory_lines;
CREATE TRIGGER trg_guard_terminated_session_lines
BEFORE INSERT OR UPDATE ON public.inventory_lines
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_terminated_session_lines();
