
-- ============================================================================
-- ÉTAPE 6 — Post-close conflict detection + enhanced MISSING_INVOICE note
-- 1. Updates the close trigger with actionable conflict_note
-- 2. Adds trigger on stock_documents for VOID/POST of linked docs after close
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- A) Update existing close trigger: more explicit MISSING_INVOICE note
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_trg_detect_order_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_conflicts text[] := '{}';
  v_notes text[] := '{}';
  v_shipped_qty numeric;
  v_received_qty numeric;
  v_requested_qty numeric;
  v_has_invoice boolean;
  v_is_cross_org boolean;
  v_line record;
BEGIN
  -- Only fire when status changes TO 'closed'
  IF NEW.status <> 'closed' OR OLD.status = 'closed' THEN
    RETURN NEW;
  END IF;

  -- Check if cross-org
  v_is_cross_org := fn_is_cross_org_order(NEW.id);

  -- ═══ CONFLICT 1: MISSING_INVOICE (B2B only) ═══
  IF v_is_cross_org THEN
    SELECT EXISTS(
      SELECT 1 FROM invoices
      WHERE b2b_order_id = NEW.id
    ) INTO v_has_invoice;

    IF NOT v_has_invoice THEN
      v_conflicts := array_append(v_conflicts, 'MISSING_INVOICE');
      v_notes := array_append(v_notes, 'Commande clôturée sans facture B2B — action requise : générer facture ou avoir');
    END IF;
  END IF;

  -- ═══ CONFLICT 2 & 3: QUANTITY checks ═══
  FOR v_line IN
    SELECT
      quantity_requested,
      quantity_prepared,
      quantity_received
    FROM product_order_lines
    WHERE order_id = NEW.id
  LOOP
    v_shipped_qty := COALESCE(v_line.quantity_prepared, v_line.quantity_requested);
    v_received_qty := v_line.quantity_received;
    v_requested_qty := v_line.quantity_requested;

    IF v_received_qty IS NOT NULL AND ABS(v_received_qty - v_shipped_qty) > 0.001 THEN
      IF NOT 'QUANTITY_MISMATCH' = ANY(v_conflicts) THEN
        v_conflicts := array_append(v_conflicts, 'QUANTITY_MISMATCH');
        v_notes := array_append(v_notes, 'Quantité reçue ≠ quantité expédiée/préparée (réf: COALESCE prepared, requested)');
      END IF;
    END IF;

    IF v_received_qty IS NOT NULL AND v_received_qty > v_requested_qty + 0.001 THEN
      IF NOT 'OVER_DELIVERY' = ANY(v_conflicts) THEN
        v_conflicts := array_append(v_conflicts, 'OVER_DELIVERY');
        v_notes := array_append(v_notes, 'Quantité reçue > quantité commandée');
      END IF;
    END IF;
  END LOOP;

  -- ═══ Apply conflict markers ═══
  IF array_length(v_conflicts, 1) > 0 THEN
    NEW.has_conflict := true;
    NEW.conflict_type := array_to_string(v_conflicts, ',');
    NEW.conflict_detected_at := now();
    NEW.conflict_note := array_to_string(v_notes, ' | ');
  ELSE
    NEW.has_conflict := false;
    NEW.conflict_type := NULL;
    NEW.conflict_detected_at := NULL;
    NEW.conflict_note := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- B) Post-close detection trigger on stock_documents
--    Detects: VOID of linked doc, or new POSTED doc with overlapping products
-- ═══════════════════════════════════════════════════════════════════════════

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
  -- ════════════════════════════════════════════════════════════════════
  -- CASE 1: VOID of a stock_document linked to a closed order
  -- Chain: stock_documents → bl_withdrawal_documents → product_orders
  --    OR: stock_documents → bl_app_documents → product_orders
  -- ════════════════════════════════════════════════════════════════════
  IF NEW.status = 'VOID' AND OLD.status <> 'VOID' THEN
    v_change_type := 'VOID de document stock après clôture';

    -- Check via bl_withdrawal_documents (retrait/expédition)
    SELECT po.id, po.status INTO v_order_id, v_order_status
    FROM bl_withdrawal_documents bwd
    JOIN product_orders po ON po.bl_retrait_document_id = bwd.id
    WHERE bwd.stock_document_id = NEW.id
    LIMIT 1;

    IF v_order_id IS NULL THEN
      -- Check via bl_app_documents (réception)
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

  -- ════════════════════════════════════════════════════════════════════
  -- CASE 2: New POSTED ADJUSTMENT on products from a closed order
  -- Chain: stock_events.product_id ∩ product_order_lines.product_id
  -- ════════════════════════════════════════════════════════════════════
  IF NEW.status = 'POSTED' AND OLD.status = 'DRAFT'
     AND NEW.document_type IN ('ADJUSTMENT', 'RETURN') THEN

    -- Get products from this stock document's events
    SELECT array_agg(DISTINCT se.product_id)
    INTO v_product_ids
    FROM stock_events se
    WHERE se.document_id = NEW.id;

    IF v_product_ids IS NOT NULL AND array_length(v_product_ids, 1) > 0 THEN
      v_change_type := CASE NEW.document_type
        WHEN 'RETURN' THEN 'Retour marchandise après clôture'
        ELSE 'Ajustement stock après clôture'
      END;

      -- Find closed orders with overlapping products in the same establishment
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

-- Trigger: AFTER UPDATE (we update OTHER rows, not the current row)
DROP TRIGGER IF EXISTS trg_detect_post_close_conflict ON public.stock_documents;
CREATE TRIGGER trg_detect_post_close_conflict
  AFTER UPDATE ON public.stock_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_trg_detect_post_close_conflict();
