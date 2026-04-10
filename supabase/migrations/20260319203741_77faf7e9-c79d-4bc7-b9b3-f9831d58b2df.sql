
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
  -- Reuse the existing V1 sentinel document
  v_sentinel_doc_id UUID := 'a0000001-0000-0000-0000-000000000001'::uuid;
BEGIN
  FOR v_rec IN
    WITH neg AS (
      SELECT 
        se.establishment_id, se.organization_id, se.product_id,
        se.storage_zone_id, se.canonical_unit_id,
        SUM(se.delta_quantity_canonical) as negative_qty
      FROM stock_events se
      GROUP BY se.establishment_id, se.organization_id, se.product_id, 
               se.storage_zone_id, se.canonical_unit_id
      HAVING SUM(se.delta_quantity_canonical) < -0.001
    )
    SELECT * FROM neg
  LOOP
    IF EXISTS (
      SELECT 1 FROM measurement_units WHERE id = v_rec.canonical_unit_id AND establishment_id = v_rec.establishment_id
    ) THEN
      v_local_unit_id := v_rec.canonical_unit_id;
    ELSE
      SELECT local_mu.id INTO v_local_unit_id
      FROM measurement_units foreign_mu
      JOIN measurement_units local_mu 
        ON local_mu.name = foreign_mu.name AND local_mu.family = foreign_mu.family
        AND local_mu.establishment_id = v_rec.establishment_id
      WHERE foreign_mu.id = v_rec.canonical_unit_id
      LIMIT 1;
      IF v_local_unit_id IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    END IF;

    SELECT zss.snapshot_version_id INTO v_snapshot_version_id
    FROM zone_stock_snapshots zss
    WHERE zss.establishment_id = v_rec.establishment_id
      AND zss.storage_zone_id = v_rec.storage_zone_id
    ORDER BY zss.activated_at DESC NULLS LAST
    LIMIT 1;

    INSERT INTO stock_events (
      establishment_id, organization_id, product_id, storage_zone_id,
      document_id, event_type, delta_quantity_canonical, canonical_unit_id,
      canonical_family, canonical_label, context_hash,
      snapshot_version_id, event_reason,
      override_flag, override_reason
    ) VALUES (
      v_rec.establishment_id, v_rec.organization_id,
      v_rec.product_id, v_rec.storage_zone_id,
      v_sentinel_doc_id, 'ADJUSTMENT', ABS(v_rec.negative_qty),
      v_local_unit_id,
      (SELECT family FROM measurement_units WHERE id = v_local_unit_id),
      (SELECT name FROM measurement_units WHERE id = v_local_unit_id),
      'phase0v2:' || substr(md5(v_rec.product_id::text || v_rec.storage_zone_id::text), 1, 8),
      v_snapshot_version_id, 'PHASE0_STOCK_ZERO_V2',
      true, 'Reset stock négatif historique Phase 0 V2'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'reset_count', v_count, 'skipped_no_local_unit', v_skipped);
END;
$$;
