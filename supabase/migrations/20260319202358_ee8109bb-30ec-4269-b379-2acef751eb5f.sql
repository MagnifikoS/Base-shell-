
-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 5 — GUARD 1: Cross-tenant unit contamination trigger
-- Prevents any stock_event from referencing a canonical_unit_id 
-- that belongs to a different establishment.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_guard_stock_event_unit_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit_est_id UUID;
BEGIN
  -- Look up which establishment owns this unit
  SELECT establishment_id INTO v_unit_est_id
  FROM measurement_units
  WHERE id = NEW.canonical_unit_id;

  -- Unit not found at all → block
  IF v_unit_est_id IS NULL THEN
    RAISE EXCEPTION 'GUARD_CROSS_TENANT: canonical_unit_id % not found in measurement_units',
      NEW.canonical_unit_id;
  END IF;

  -- Unit belongs to a different establishment → block
  IF v_unit_est_id <> NEW.establishment_id THEN
    RAISE EXCEPTION 'GUARD_CROSS_TENANT: canonical_unit_id % belongs to establishment % but stock_event targets establishment %',
      NEW.canonical_unit_id, v_unit_est_id, NEW.establishment_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach to stock_events (BEFORE INSERT only — updates are not expected on this append-only table)
DROP TRIGGER IF EXISTS trg_guard_stock_event_unit_ownership ON stock_events;
CREATE TRIGGER trg_guard_stock_event_unit_ownership
  BEFORE INSERT ON stock_events
  FOR EACH ROW
  EXECUTE FUNCTION trg_guard_stock_event_unit_ownership();

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 5 — GUARD 2: Health check RPC for stock integrity
-- Returns a comprehensive diagnostic of the stock ledger.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_health_check_stock_integrity()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cross_tenant_count INT;
  v_negative_stock_count INT;
  v_override_by_source JSONB;
  v_result JSONB;
BEGIN
  -- 1. Cross-tenant events: unit belongs to different establishment
  SELECT COUNT(*) INTO v_cross_tenant_count
  FROM stock_events se
  JOIN measurement_units mu ON mu.id = se.canonical_unit_id
  WHERE mu.establishment_id <> se.establishment_id;

  -- 2. Products with negative estimated stock
  SELECT COUNT(*) INTO v_negative_stock_count
  FROM (
    SELECT 
      se.product_id,
      se.establishment_id,
      se.storage_zone_id,
      SUM(se.delta_quantity_canonical) AS total_qty
    FROM stock_events se
    GROUP BY se.product_id, se.establishment_id, se.storage_zone_id
    HAVING SUM(se.delta_quantity_canonical) < -0.0001
  ) neg;

  -- 3. Override usage by event_reason (source function)
  SELECT COALESCE(jsonb_object_agg(reason, cnt), '{}'::jsonb)
  INTO v_override_by_source
  FROM (
    SELECT 
      COALESCE(event_reason, 'UNKNOWN') AS reason,
      COUNT(*) AS cnt
    FROM stock_events
    WHERE override_flag = true
    GROUP BY event_reason
    ORDER BY cnt DESC
  ) src;

  v_result := jsonb_build_object(
    'cross_tenant_events', v_cross_tenant_count,
    'negative_stock_products', v_negative_stock_count,
    'override_by_source', v_override_by_source,
    'checked_at', now()::text
  );

  RETURN v_result;
END;
$$;
