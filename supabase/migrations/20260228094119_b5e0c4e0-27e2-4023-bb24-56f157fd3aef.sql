
CREATE OR REPLACE FUNCTION public._test_post_trigger_error(p_doc_id uuid)
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_err text;
BEGIN
  UPDATE stock_documents
  SET status = 'POSTED', posted_at = now(), posted_by = created_by
  WHERE id = p_doc_id AND status = 'DRAFT';
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  RETURN 'ERROR: ' || v_err;
END $$;
