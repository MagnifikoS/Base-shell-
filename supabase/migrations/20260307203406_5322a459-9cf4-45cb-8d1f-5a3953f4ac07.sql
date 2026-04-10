CREATE OR REPLACE FUNCTION public.fn_delete_invoice(p_invoice_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_purchase_deleted INT;
  v_lines_deleted INT;
  v_extractions_deleted INT;
BEGIN
  SELECT id, file_path, establishment_id, organization_id
  INTO v_invoice
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'detail', 'Invoice already deleted');
  END IF;

  INSERT INTO audit_logs (action, target_type, target_id, organization_id, user_id, metadata)
  VALUES (
    'hard_delete:invoices',
    'invoices',
    p_invoice_id,
    v_invoice.organization_id,
    p_user_id,
    jsonb_build_object(
      'table', 'invoices',
      'cascade', ARRAY['purchase_line_items', 'invoice_line_items', 'invoice_extractions'],
      'file_path', v_invoice.file_path,
      'reason', 'Atomic server-side deletion'
    )
  );

  DELETE FROM purchase_line_items WHERE invoice_id = p_invoice_id;
  GET DIAGNOSTICS v_purchase_deleted = ROW_COUNT;

  DELETE FROM invoice_line_items WHERE invoice_id = p_invoice_id;
  GET DIAGNOSTICS v_lines_deleted = ROW_COUNT;

  DELETE FROM invoice_extractions WHERE invoice_id = p_invoice_id;
  GET DIAGNOSTICS v_extractions_deleted = ROW_COUNT;

  DELETE FROM invoices WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'ok', true,
    'file_path', v_invoice.file_path,
    'deleted_purchase_lines', v_purchase_deleted,
    'deleted_invoice_lines', v_lines_deleted,
    'deleted_extractions', v_extractions_deleted
  );
END;
$$;