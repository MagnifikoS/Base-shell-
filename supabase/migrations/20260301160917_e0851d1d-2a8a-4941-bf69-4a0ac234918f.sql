
-- ═══════════════════════════════════════════════════════════════════════════
-- CHANTIER 1: Atomic invoice delete (fn_delete_invoice)
-- ═══════════════════════════════════════════════════════════════════════════
-- Replaces multi-step client-side deleteInvoice with single transaction.
-- Storage cleanup remains best-effort (outside DB transaction).

CREATE OR REPLACE FUNCTION public.fn_delete_invoice(
  p_invoice_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_invoice RECORD;
  v_purchase_deleted INT;
  v_lines_deleted INT;
  v_extractions_deleted INT;
BEGIN
  -- 1. Lock and fetch invoice
  SELECT id, file_path, establishment_id, organization_id
  INTO v_invoice
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Idempotency: already deleted
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'detail', 'Invoice already deleted');
  END IF;

  -- 2. Audit log BEFORE deletion
  INSERT INTO audit_logs (action, target_type, target_id, organization_id, user_id, metadata)
  VALUES (
    'hard_delete:invoices',
    'invoices',
    p_invoice_id::text,
    v_invoice.organization_id,
    p_user_id,
    jsonb_build_object(
      'table', 'invoices',
      'cascade', ARRAY['purchase_line_items', 'invoice_line_items', 'invoice_extractions'],
      'file_path', v_invoice.file_path,
      'reason', 'Atomic server-side deletion'
    )
  );

  -- 3. Delete children in FK order (all within same transaction)
  DELETE FROM purchase_line_items WHERE invoice_id = p_invoice_id;
  GET DIAGNOSTICS v_purchase_deleted = ROW_COUNT;

  DELETE FROM invoice_line_items WHERE invoice_id = p_invoice_id;
  GET DIAGNOSTICS v_lines_deleted = ROW_COUNT;

  DELETE FROM invoice_extractions WHERE invoice_id = p_invoice_id;
  GET DIAGNOSTICS v_extractions_deleted = ROW_COUNT;

  -- 4. Delete parent invoice
  DELETE FROM invoices WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'ok', true,
    'file_path', v_invoice.file_path,
    'deleted_purchase_lines', v_purchase_deleted,
    'deleted_invoice_lines', v_lines_deleted,
    'deleted_extractions', v_extractions_deleted
  );
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- CHANTIER 2: Atomic inventory complete session (fn_complete_inventory_session)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_complete_inventory_session(
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_session RECORD;
  v_actual_counted INT;
  v_actual_total INT;
BEGIN
  -- 1. Lock session
  SELECT id, status, establishment_id, organization_id, storage_zone_id
  INTO v_session
  FROM inventory_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND');
  END IF;

  -- Idempotency: already completed
  IF v_session.status = 'termine' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  -- Precondition: must be en_cours or en_pause
  IF v_session.status NOT IN ('en_cours', 'en_pause') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STATUS_CONFLICT', 'current_status', v_session.status);
  END IF;

  -- 2. Reconcile counts
  SELECT COUNT(*) FILTER (WHERE counted_at IS NOT NULL), COUNT(*)
  INTO v_actual_counted, v_actual_total
  FROM inventory_lines
  WHERE session_id = p_session_id;

  -- 3. Atomic: update session + upsert snapshot in same transaction
  UPDATE inventory_sessions
  SET status = 'termine',
      completed_at = NOW(),
      counted_products = v_actual_counted,
      total_products = v_actual_total,
      updated_at = NOW()
  WHERE id = p_session_id;

  -- 4. Upsert zone snapshot (SSOT for stock calculations)
  INSERT INTO zone_stock_snapshots (establishment_id, organization_id, storage_zone_id, snapshot_version_id, activated_at)
  VALUES (v_session.establishment_id, v_session.organization_id, v_session.storage_zone_id, p_session_id, NOW())
  ON CONFLICT (establishment_id, storage_zone_id)
  DO UPDATE SET
    snapshot_version_id = EXCLUDED.snapshot_version_id,
    activated_at = EXCLUDED.activated_at,
    is_active = true;

  RETURN jsonb_build_object(
    'ok', true,
    'counted_products', v_actual_counted,
    'total_products', v_actual_total
  );
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- CHANTIER 3: Server-side order transition guard
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_order_status_transition_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  -- Only enforce when status actually changes
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- State machine whitelist (must match orderStateMachine.ts)
  IF NOT (
    (OLD.status = 'draft'     AND NEW.status IN ('sent'))
    OR (OLD.status = 'sent'      AND NEW.status IN ('preparing', 'prepared'))
    OR (OLD.status = 'preparing' AND NEW.status IN ('prepared'))
    OR (OLD.status = 'prepared'  AND NEW.status IN ('shipped'))
    OR (OLD.status = 'shipped'   AND NEW.status IN ('received', 'prepared'))
    OR (OLD.status = 'received'  AND NEW.status IN ('closed'))
  ) THEN
    RAISE EXCEPTION 'ORDER_TRANSITION_ILLEGAL: % → % is not allowed', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$fn$;

-- Attach trigger (drop first if exists to be idempotent)
DROP TRIGGER IF EXISTS trg_order_status_transition_guard ON product_orders;

CREATE TRIGGER trg_order_status_transition_guard
  BEFORE UPDATE OF status ON product_orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_order_status_transition_guard();
