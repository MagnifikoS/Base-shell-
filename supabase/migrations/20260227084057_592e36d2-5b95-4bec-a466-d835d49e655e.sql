
-- Fix: stock_documents column is 'type' not 'document_type'
CREATE OR REPLACE FUNCTION fn_trg_b2b_close_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_has_reception BOOLEAN := FALSE;
BEGIN
  IF NEW.status != 'closed' OR OLD.status = 'closed' THEN
    RETURN NEW;
  END IF;

  IF NOT fn_is_cross_org_order(NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Check reception proof: bl_reception_document_id OR stock_documents RECEIPT POSTED
  IF NEW.bl_reception_document_id IS NOT NULL THEN
    v_has_reception := TRUE;
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM stock_documents sd
      WHERE sd.status = 'POSTED'
        AND sd.type = 'RECEIPT'
        AND sd.idempotency_key = 'b2b-receipt-' || NEW.id::text
    ) INTO v_has_reception;
  END IF;

  IF NOT v_has_reception THEN
    RAISE EXCEPTION 'B2B_CLOSE_GUARD: Cannot close cross-org order % without reception proof (bl_reception_document_id or POSTED RECEIPT with matching idempotency_key)', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;
