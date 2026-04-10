
-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 0 V2 — Reset all negative stock balances to zero
-- 
-- Strategy: For each negative product-zone, insert an ADJUSTMENT event
-- that brings the balance to exactly 0. Uses the product's LOCAL 
-- canonical unit (from products_v2 via conditionnement_config) to avoid
-- triggering the cross-tenant guard.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_phase0_stock_zero_v2()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
  v_skipped INT := 0;
  v_local_unit_id UUID;
  v_snapshot_version_id UUID;
BEGIN
  -- Find all negative balances grouped by product+zone+unit
  FOR v_rec IN
    WITH neg AS (
      SELECT 
        se.establishment_id,
        se.organization_id,
        se.product_id,
        se.storage_zone_id,
        se.canonical_unit_id,
        SUM(se.delta_quantity_canonical) as negative_qty
      FROM stock_events se
      GROUP BY se.establishment_id, se.organization_id, se.product_id, 
               se.storage_zone_id, se.canonical_unit_id
      HAVING SUM(se.delta_quantity_canonical) < -0.001
    )
    SELECT * FROM neg
  LOOP
    -- Resolve local unit: if unit is cross-tenant, find matching local unit by name+family
    IF EXISTS (
      SELECT 1 FROM measurement_units 
      WHERE id = v_rec.canonical_unit_id 
        AND establishment_id = v_rec.establishment_id
    ) THEN
      v_local_unit_id := v_rec.canonical_unit_id;
    ELSE
      -- Find local equivalent by name+family
      SELECT local_mu.id INTO v_local_unit_id
      FROM measurement_units foreign_mu
      JOIN measurement_units local_mu 
        ON local_mu.name = foreign_mu.name 
        AND local_mu.family = foreign_mu.family
        AND local_mu.establishment_id = v_rec.establishment_id
      WHERE foreign_mu.id = v_rec.canonical_unit_id
      LIMIT 1;
      
      IF v_local_unit_id IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    END IF;

    -- Get active snapshot version for this zone
    SELECT sv.id INTO v_snapshot_version_id
    FROM zone_snapshot_status zss
    JOIN snapshot_versions sv ON sv.id = zss.active_snapshot_version_id
    WHERE zss.establishment_id = v_rec.establishment_id
      AND zss.storage_zone_id = v_rec.storage_zone_id
    LIMIT 1;

    -- Insert corrective ADJUSTMENT event to bring balance to 0
    -- delta = ABS(negative_qty) to cancel the negative balance
    INSERT INTO stock_events (
      establishment_id, organization_id, product_id, storage_zone_id,
      event_type, delta_quantity_canonical, canonical_unit_id,
      canonical_family, canonical_label,
      snapshot_version_id, event_reason,
      override_flag, override_reason
    ) VALUES (
      v_rec.establishment_id,
      v_rec.organization_id,
      v_rec.product_id,
      v_rec.storage_zone_id,
      'ADJUSTMENT',
      ABS(v_rec.negative_qty),  -- positive delta to cancel negative
      v_local_unit_id,
      (SELECT family FROM measurement_units WHERE id = v_local_unit_id),
      (SELECT name FROM measurement_units WHERE id = v_local_unit_id),
      v_snapshot_version_id,
      'PHASE0_STOCK_ZERO_V2',
      true,
      'Reset stock négatif historique Phase 0 V2'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'reset_count', v_count,
    'skipped_no_local_unit', v_skipped
  );
END;
$$;
