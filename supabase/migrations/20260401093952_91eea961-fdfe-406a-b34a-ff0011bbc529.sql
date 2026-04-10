
DO $$
DECLARE
  v_org_id UUID := '3e4bf632-974d-47ef-bd82-636901b9f7f4';
  v_estab_id UUID := '7775d89d-9977-4b1b-bf0c-1b2efe486000';
  v_user_id UUID := '5eb12587-71fb-45df-b9e2-b5192124d612';
  v_zone RECORD;
  v_session_id UUID;
  v_product RECORD;
  v_count INTEGER;
BEGIN
  FOR v_zone IN
    SELECT DISTINCT p.storage_zone_id
    FROM products_v2 p
    WHERE p.establishment_id = v_estab_id
      AND p.archived_at IS NULL
      AND p.storage_zone_id IS NOT NULL
  LOOP
    v_session_id := gen_random_uuid();
    
    -- Create session as en_cours first
    INSERT INTO inventory_sessions (
      id, organization_id, establishment_id, storage_zone_id,
      status, started_at, started_by,
      total_products, counted_products
    ) VALUES (
      v_session_id, v_org_id, v_estab_id, v_zone.storage_zone_id,
      'en_cours', now(), v_user_id, 0, 0
    );

    -- Insert lines while session is still en_cours
    v_count := 0;
    FOR v_product IN
      SELECT id, stock_handling_unit_id
      FROM products_v2
      WHERE establishment_id = v_estab_id
        AND archived_at IS NULL
        AND storage_zone_id = v_zone.storage_zone_id
    LOOP
      INSERT INTO inventory_lines (
        session_id, product_id, quantity, unit_id,
        counted_at, counted_by
      ) VALUES (
        v_session_id, v_product.id, 0, v_product.stock_handling_unit_id,
        now(), v_user_id
      );
      v_count := v_count + 1;
    END LOOP;

    -- Now terminate the session
    UPDATE inventory_sessions
    SET status = 'termine',
        completed_at = now(),
        total_products = v_count,
        counted_products = v_count
    WHERE id = v_session_id;

    -- Create the zone snapshot reference
    INSERT INTO zone_stock_snapshots (
      establishment_id, organization_id, storage_zone_id,
      snapshot_version_id, activated_at, activated_by
    ) VALUES (
      v_estab_id, v_org_id, v_zone.storage_zone_id,
      v_session_id, now(), v_user_id
    );
  END LOOP;
END $$;
