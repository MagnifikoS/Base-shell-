
-- FIX: Replace 'RETURN' (invalid enum value) with 'RECEIPT_CORRECTION' in trigger
-- The enum stock_document_type has: RECEIPT, WITHDRAWAL, ADJUSTMENT, RECEIPT_CORRECTION, INITIAL_STOCK
-- 'RETURN' does not exist and causes "invalid input value for enum" on every POST

CREATE OR REPLACE FUNCTION public.fn_trg_detect_post_close_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_order_status text;
  v_existing_note text;
  v_change_type text;
  v_product_ids uuid[];
BEGIN
  IF NEW.status = 'VOID' AND OLD.status <> 'VOID' THEN
    v_change_type := 'VOID de document stock après clôture';

    SELECT po.id, po.status INTO v_order_id, v_order_status
    FROM bl_withdrawal_documents bwd
    JOIN product_orders po ON po.bl_retrait_document_id = bwd.id
    WHERE bwd.stock_document_id = NEW.id
    LIMIT 1;

    IF v_order_id IS NULL THEN
      SELECT po.id, po.status INTO v_order_id, v_order_status
      FROM bl_app_documents bad
      JOIN product_orders po ON po.bl_reception_document_id = bad.id
      WHERE bad.stock_document_id = NEW.id
      LIMIT 1;
    END IF;

    IF v_order_id IS NOT NULL AND v_order_status = 'closed' THEN
      SELECT conflict_note INTO v_existing_note
      FROM product_orders WHERE id = v_order_id;

      UPDATE product_orders
      SET has_conflict = true,
          conflict_detected_at = now(),
          conflict_note = COALESCE(v_existing_note || ' | ', '') || v_change_type || ' (doc: ' || NEW.id || ')'
      WHERE id = v_order_id;
    END IF;
  END IF;

  IF NEW.status = 'POSTED' AND OLD.status = 'DRAFT'
     AND NEW.type IN ('ADJUSTMENT', 'RECEIPT_CORRECTION') THEN

    SELECT array_agg(DISTINCT se.product_id)
    INTO v_product_ids
    FROM stock_events se
    WHERE se.document_id = NEW.id;

    IF v_product_ids IS NOT NULL AND array_length(v_product_ids, 1) > 0 THEN
      v_change_type := CASE NEW.type
        WHEN 'RECEIPT_CORRECTION' THEN 'Correction de réception après clôture'
        ELSE 'Ajustement stock après clôture'
      END;

      UPDATE product_orders po
      SET has_conflict = true,
          conflict_detected_at = now(),
          conflict_note = COALESCE(po.conflict_note || ' | ', '') || v_change_type || ' (doc: ' || NEW.id || ')'
      FROM product_order_lines pol
      WHERE pol.order_id = po.id
        AND po.status = 'closed'
        AND (po.source_establishment_id = NEW.establishment_id
             OR po.destination_establishment_id = NEW.establishment_id)
        AND pol.product_id = ANY(v_product_ids);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
