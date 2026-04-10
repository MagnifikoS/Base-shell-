
-- FIX P0: Add prepared → awaiting_client_validation for cross-org B2B
-- Also remove awaiting_client_validation → received (not standard cross-org path)
-- Also document: organization_id is NEVER NULL on establishments (0 nulls confirmed)
CREATE OR REPLACE FUNCTION fn_trg_b2b_status_transition_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
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
  -- Standard forward path:
  --   draft → sent → preparing → prepared → awaiting_client_validation → closed (via RPC)
  -- Alternative forward path (if shipped is used):
  --   prepared → shipped → awaiting_client_validation → closed (via RPC)
  -- Backward (cancellation):
  --   shipped → prepared, awaiting_client_validation → prepared, sent → draft
  IF NOT (
    -- Forward transitions
    (OLD.status = 'draft' AND NEW.status = 'sent') OR
    (OLD.status = 'sent' AND NEW.status = 'preparing') OR
    (OLD.status = 'preparing' AND NEW.status = 'prepared') OR
    (OLD.status = 'prepared' AND NEW.status = 'shipped') OR
    (OLD.status = 'prepared' AND NEW.status = 'awaiting_client_validation') OR  -- P0 FIX: direct B2B shipment
    (OLD.status = 'shipped' AND NEW.status = 'awaiting_client_validation') OR
    (OLD.status = 'awaiting_client_validation' AND NEW.status = 'closed') OR
    -- Backward transitions (cancellation flows)
    (OLD.status = 'shipped' AND NEW.status = 'prepared') OR
    (OLD.status = 'awaiting_client_validation' AND NEW.status = 'prepared') OR
    (OLD.status = 'sent' AND NEW.status = 'draft')
  ) THEN
    RAISE EXCEPTION 'B2B_TRANSITION_GUARD: Illegal cross-org status transition from "%" to "%" on order %', OLD.status, NEW.status, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;
