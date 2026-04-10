
-- ÉTAPE A: Enrichir le WARNING du trigger fail-safe avec doc_id, type, status
CREATE OR REPLACE FUNCTION public.fn_trg_detect_post_close_conflict()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_order_status text;
  v_existing_note text;
  v_change_type text;
  v_product_ids uuid[];
BEGIN
  -- ═══ FAIL-SAFE WRAPPER ═══
  -- This trigger is advisory (conflict detection). It must NEVER block
  -- a POST or VOID operation. Any internal error is swallowed and logged.
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
            conflict_note = COALESCE(v_existing_note || ' | ', '') ||
              v_change_type || ' (doc: ' || NEW.id || ')'
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
            conflict_note = COALESCE(po.conflict_note || ' | ', '') ||
              v_change_type || ' (doc: ' || NEW.id || ')'
        FROM product_order_lines pol
        WHERE pol.order_id = po.id
          AND po.status = 'closed'
          AND (po.source_establishment_id = NEW.establishment_id
               OR po.destination_establishment_id = NEW.establishment_id)
          AND pol.product_id = ANY(v_product_ids);
      END IF;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- Fail-safe: log warning but NEVER block the POST/VOID
    -- Enriched with doc context for debugging
    RAISE WARNING 'fn_trg_detect_post_close_conflict fail-safe caught: % % (doc_id=%, type=%, status=%)',
      SQLERRM, SQLSTATE, NEW.id, NEW.type, NEW.status;
  END;

  RETURN NEW;
END;
$function$;
