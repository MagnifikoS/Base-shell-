
-- ============================================================================
-- ÉTAPE 5 — Conflict detection on order closure
-- Adds has_conflict, conflict_type, conflict_detected_at, conflict_note
-- + trigger that auto-detects conflicts when status changes to 'closed'
-- ============================================================================

-- 1. Add conflict columns to product_orders
ALTER TABLE public.product_orders
  ADD COLUMN IF NOT EXISTS has_conflict boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conflict_type text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS conflict_detected_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS conflict_note text DEFAULT NULL;

-- 2. Index for fast conflict filtering
CREATE INDEX IF NOT EXISTS idx_product_orders_conflict
  ON public.product_orders (has_conflict)
  WHERE has_conflict = true;

-- 3. Trigger function: detect conflicts on close
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

  -- Check if cross-org (B2B invoice check only applies to cross-org)
  v_is_cross_org := fn_is_cross_org_order(NEW.id);

  -- ═══ CONFLICT 1: MISSING_INVOICE (B2B only) ═══
  IF v_is_cross_org THEN
    SELECT EXISTS(
      SELECT 1 FROM invoices
      WHERE b2b_order_id = NEW.id
    ) INTO v_has_invoice;

    IF NOT v_has_invoice THEN
      v_conflicts := array_append(v_conflicts, 'MISSING_INVOICE');
      v_notes := array_append(v_notes, 'Facture B2B manquante à la clôture');
    END IF;
  END IF;

  -- ═══ CONFLICT 2 & 3: QUANTITY checks ═══
  -- Compare received vs shipped (if shipped), or received vs requested
  FOR v_line IN
    SELECT
      quantity_requested,
      quantity_prepared,
      quantity_received
    FROM product_order_lines
    WHERE order_id = NEW.id
  LOOP
    -- Use quantity_prepared as "shipped" if available, else requested
    v_shipped_qty := COALESCE(v_line.quantity_prepared, v_line.quantity_requested);
    v_received_qty := v_line.quantity_received;
    v_requested_qty := v_line.quantity_requested;

    -- QUANTITY_MISMATCH: received ≠ shipped (tolerance 0.001)
    IF v_received_qty IS NOT NULL AND ABS(v_received_qty - v_shipped_qty) > 0.001 THEN
      IF NOT 'QUANTITY_MISMATCH' = ANY(v_conflicts) THEN
        v_conflicts := array_append(v_conflicts, 'QUANTITY_MISMATCH');
        v_notes := array_append(v_notes, 'Quantité reçue ≠ quantité expédiée');
      END IF;
    END IF;

    -- OVER_DELIVERY: received > requested (tolerance 0.001)
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

-- 4. Create trigger (BEFORE UPDATE — modifies NEW row)
DROP TRIGGER IF EXISTS trg_detect_order_conflict ON public.product_orders;
CREATE TRIGGER trg_detect_order_conflict
  BEFORE UPDATE ON public.product_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_trg_detect_order_conflict();
