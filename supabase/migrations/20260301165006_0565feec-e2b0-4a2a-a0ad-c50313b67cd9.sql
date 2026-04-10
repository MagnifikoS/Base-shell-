
-- ═══════════════════════════════════════════════════════════════════════════
-- ATOMIC REPLACE INVOICE (fn_replace_invoice)
-- ═══════════════════════════════════════════════════════════════════════════
-- Single transaction: lock old → audit → delete old children → delete old → insert new → return new id.
-- If ANY step fails → full rollback, old invoice untouched.
-- Idempotent: uses p_idempotency_key to detect retries.

CREATE OR REPLACE FUNCTION public.fn_replace_invoice(
  p_old_invoice_id UUID,
  p_idempotency_key TEXT,
  p_user_id UUID,
  -- new invoice fields
  p_establishment_id UUID,
  p_organization_id UUID,
  p_supplier_id UUID,
  p_supplier_name TEXT DEFAULT NULL,
  p_invoice_number TEXT DEFAULT NULL,
  p_invoice_date DATE DEFAULT NULL,
  p_amount_eur NUMERIC DEFAULT NULL,
  p_file_path TEXT DEFAULT NULL,
  p_file_name TEXT DEFAULT NULL,
  p_file_size INT DEFAULT NULL,
  p_file_type TEXT DEFAULT 'application/pdf'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_old RECORD;
  v_new_id UUID;
  v_existing_id UUID;
  v_purchase_deleted INT;
  v_lines_deleted INT;
  v_extractions_deleted INT;
  v_old_file_path TEXT;
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- 0. IDEMPOTENCY CHECK: if this key already produced an invoice, return it
  -- ═══════════════════════════════════════════════════════════════
  IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' THEN
    SELECT target_id::UUID INTO v_existing_id
    FROM audit_logs
    WHERE action = 'replace:invoices'
      AND organization_id = p_organization_id
      AND metadata->>'idempotency_key' = p_idempotency_key
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'new_invoice_id', v_existing_id,
        'detail', 'Replace already completed for this idempotency key'
      );
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- 1. LOCK old invoice (anti-concurrence)
  -- ═══════════════════════════════════════════════════════════════
  SELECT id, file_path, establishment_id, organization_id
  INTO v_old
  FROM invoices
  WHERE id = p_old_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Old invoice already gone (concurrent delete or previous replace)
    -- Check if this was our own idempotent replace (audit exists)
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'OLD_INVOICE_NOT_FOUND',
      'detail', 'The invoice to replace no longer exists'
    );
  END IF;

  v_old_file_path := v_old.file_path;

  -- ═══════════════════════════════════════════════════════════════
  -- 2. INSERT new invoice FIRST (if this fails, nothing is deleted)
  -- ═══════════════════════════════════════════════════════════════
  INSERT INTO invoices (
    establishment_id, organization_id, supplier_id, supplier_name,
    invoice_number, invoice_date, amount_eur,
    file_path, file_name, file_size, file_type,
    created_by, is_paid
  ) VALUES (
    p_establishment_id, p_organization_id, p_supplier_id, p_supplier_name,
    p_invoice_number, p_invoice_date, p_amount_eur,
    p_file_path, p_file_name, p_file_size, p_file_type,
    p_user_id, false
  )
  RETURNING id INTO v_new_id;

  -- ═══════════════════════════════════════════════════════════════
  -- 3. DELETE old children (FK order)
  -- ═══════════════════════════════════════════════════════════════
  DELETE FROM purchase_line_items WHERE invoice_id = p_old_invoice_id;
  GET DIAGNOSTICS v_purchase_deleted = ROW_COUNT;

  DELETE FROM invoice_line_items WHERE invoice_id = p_old_invoice_id;
  GET DIAGNOSTICS v_lines_deleted = ROW_COUNT;

  DELETE FROM invoice_extractions WHERE invoice_id = p_old_invoice_id;
  GET DIAGNOSTICS v_extractions_deleted = ROW_COUNT;

  -- ═══════════════════════════════════════════════════════════════
  -- 4. DELETE old invoice
  -- ═══════════════════════════════════════════════════════════════
  DELETE FROM invoices WHERE id = p_old_invoice_id;

  -- ═══════════════════════════════════════════════════════════════
  -- 5. AUDIT LOG (inside transaction — committed only if all succeeds)
  -- ═══════════════════════════════════════════════════════════════
  INSERT INTO audit_logs (action, target_type, target_id, organization_id, user_id, metadata)
  VALUES (
    'replace:invoices',
    'invoices',
    v_new_id::text,
    p_organization_id,
    p_user_id,
    jsonb_build_object(
      'old_invoice_id', p_old_invoice_id,
      'new_invoice_id', v_new_id,
      'old_file_path', v_old_file_path,
      'new_file_path', p_file_path,
      'idempotency_key', p_idempotency_key,
      'deleted_purchase_lines', v_purchase_deleted,
      'deleted_invoice_lines', v_lines_deleted,
      'deleted_extractions', v_extractions_deleted
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'new_invoice_id', v_new_id,
    'old_file_path', v_old_file_path,
    'deleted_purchase_lines', v_purchase_deleted,
    'deleted_invoice_lines', v_lines_deleted,
    'deleted_extractions', v_extractions_deleted
  );
END;
$fn$;
