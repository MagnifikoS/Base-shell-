
-- ============================================================================
-- STEP 2: B2B SERVER-SIDE LOCKDOWN — 4 TRIGGERS
-- Backward compatible: only applies to cross-org orders
-- Rollback: DROP the 4 triggers + 4 functions
-- ============================================================================

-- ============================================================================
-- HELPER: Detect if an order is cross-org
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_is_cross_org_order(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT (e_src.organization_id IS DISTINCT FROM e_dst.organization_id)
  FROM product_orders po
  JOIN establishments e_src ON e_src.id = po.source_establishment_id
  JOIN establishments e_dst ON e_dst.id = po.destination_establishment_id
  WHERE po.id = p_order_id;
$$;

-- ============================================================================
-- TRIGGER 1: CLOSE GUARD — cross-org orders cannot be closed without reception proof
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_trg_b2b_close_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_has_reception BOOLEAN := FALSE;
BEGIN
  -- Only fires on transition TO 'closed'
  IF NEW.status != 'closed' OR OLD.status = 'closed' THEN
    RETURN NEW;
  END IF;

  -- Only applies to cross-org orders
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
        AND sd.document_type = 'RECEIPT'
        AND sd.idempotency_key = 'b2b-receipt-' || NEW.id::text
    ) INTO v_has_reception;
  END IF;

  IF NOT v_has_reception THEN
    RAISE EXCEPTION 'B2B_CLOSE_GUARD: Cannot close cross-org order % without reception proof (bl_reception_document_id or POSTED RECEIPT with matching idempotency_key)', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_b2b_close_guard ON product_orders;
CREATE TRIGGER trg_b2b_close_guard
  BEFORE UPDATE ON product_orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_trg_b2b_close_guard();

-- ============================================================================
-- TRIGGER 2: STATUS TRANSITION GUARD — enforce state machine for cross-org
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_trg_b2b_status_transition_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only fires on status change
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Only applies to cross-org orders
  IF NOT fn_is_cross_org_order(NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Allowed transitions for cross-org B2B
  -- draft -> sent -> preparing -> prepared -> shipped -> awaiting_client_validation -> closed
  -- Also allow: awaiting_client_validation -> received -> closed (correction flow)
  -- Also allow: shipped -> prepared (cancellation via fn_cancel_b2b_shipment)
  IF NOT (
    (OLD.status = 'draft' AND NEW.status = 'sent') OR
    (OLD.status = 'sent' AND NEW.status = 'preparing') OR
    (OLD.status = 'preparing' AND NEW.status = 'prepared') OR
    (OLD.status = 'prepared' AND NEW.status = 'shipped') OR
    (OLD.status = 'shipped' AND NEW.status = 'awaiting_client_validation') OR
    (OLD.status = 'awaiting_client_validation' AND NEW.status IN ('closed', 'received')) OR
    (OLD.status = 'received' AND NEW.status = 'closed') OR
    -- Backward transitions (cancellation flows)
    (OLD.status = 'shipped' AND NEW.status = 'prepared') OR
    (OLD.status = 'awaiting_client_validation' AND NEW.status = 'prepared') OR
    -- Draft edits
    (OLD.status = 'sent' AND NEW.status = 'draft')
  ) THEN
    RAISE EXCEPTION 'B2B_TRANSITION_GUARD: Illegal cross-org status transition from "%" to "%" on order %', OLD.status, NEW.status, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_b2b_status_transition_guard ON product_orders;
CREATE TRIGGER trg_b2b_status_transition_guard
  BEFORE UPDATE ON product_orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_trg_b2b_status_transition_guard();

-- ============================================================================
-- TRIGGER 3: LINE DELETION GUARD — prevent deleting lines in transit for cross-org
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_trg_b2b_line_deletion_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_order_status TEXT;
  v_remaining_lines INTEGER;
BEGIN
  -- Get order status
  SELECT po.status INTO v_order_status
  FROM product_orders po
  WHERE po.id = OLD.order_id;

  -- Only applies to cross-org orders in transit or beyond
  IF v_order_status NOT IN ('shipped', 'awaiting_client_validation', 'received', 'closed') THEN
    RETURN OLD;
  END IF;

  IF NOT fn_is_cross_org_order(OLD.order_id) THEN
    RETURN OLD;
  END IF;

  -- Block deletion entirely for cross-org orders in transit+
  RAISE EXCEPTION 'B2B_LINE_DELETE_GUARD: Cannot delete order line % from cross-org order in status "%"', OLD.id, v_order_status;
END;
$$;

DROP TRIGGER IF EXISTS trg_b2b_line_deletion_guard ON product_order_lines;
CREATE TRIGGER trg_b2b_line_deletion_guard
  BEFORE DELETE ON product_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION fn_trg_b2b_line_deletion_guard();

-- ============================================================================
-- TRIGGER 4: MAPPING INTEGRITY GUARD — resolved_supplier_product_id must belong
-- to the destination establishment (supplier side) if set
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_trg_b2b_mapping_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_dest_establishment_id UUID;
  v_product_establishment_id UUID;
BEGIN
  -- Only fires when resolved_supplier_product_id is being set or changed
  IF NEW.resolved_supplier_product_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.resolved_supplier_product_id IS NOT DISTINCT FROM NEW.resolved_supplier_product_id THEN
    RETURN NEW;
  END IF;

  -- Get the order's destination (supplier) establishment
  SELECT po.destination_establishment_id INTO v_dest_establishment_id
  FROM product_orders po
  WHERE po.id = NEW.order_id;

  -- Only applies to cross-org
  IF NOT fn_is_cross_org_order(NEW.order_id) THEN
    RETURN NEW;
  END IF;

  -- Verify the resolved product belongs to the supplier's establishment
  SELECT p.establishment_id INTO v_product_establishment_id
  FROM products_v2 p
  WHERE p.id = NEW.resolved_supplier_product_id;

  IF v_product_establishment_id IS NULL THEN
    RAISE EXCEPTION 'B2B_MAPPING_GUARD: resolved_supplier_product_id % does not exist in products_v2', NEW.resolved_supplier_product_id;
  END IF;

  IF v_product_establishment_id != v_dest_establishment_id THEN
    RAISE EXCEPTION 'B2B_MAPPING_GUARD: resolved_supplier_product_id % belongs to establishment %, not to supplier establishment %', 
      NEW.resolved_supplier_product_id, v_product_establishment_id, v_dest_establishment_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_b2b_mapping_guard ON product_order_lines;
CREATE TRIGGER trg_b2b_mapping_guard
  BEFORE UPDATE ON product_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION fn_trg_b2b_mapping_guard();
