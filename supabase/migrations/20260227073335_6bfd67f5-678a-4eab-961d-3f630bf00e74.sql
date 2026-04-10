
-- ====================================================================
-- B2B TEST: Provision initial stock for Nonna Secret test products
-- Creates a stock_document RECEIPT + stock_events for each product
-- Quantities: 100 units each (enough for all 8 test scenarios)
-- ====================================================================

DO $$
DECLARE
  v_doc_id UUID;
  v_nonna_id UUID := '7775d89d-9977-4b1b-bf0c-1b2efe486000';
  v_nonna_org UUID := '3e4bf632-974d-47ef-bd82-636901b9f7f4';
  v_user_id UUID := '52a9aeec-8bff-4760-848f-2764f983508b';
  v_products UUID[] := ARRAY[
    'a0000001-0e50-b2b0-0000-000000000001'::UUID, -- TOMATE (zone dcfd...)
    'a0000001-0e50-b2b0-0000-000000000002'::UUID, -- MOZZA (zone 38b9...)
    'a0000001-0e50-b2b0-0000-000000000003'::UUID, -- HUILE (zone dcfd...)
    'a0000001-0e50-b2b0-0000-000000000004'::UUID, -- BASILIC (zone 38b9...)
    'a0000001-0e50-b2b0-0000-000000000005'::UUID, -- FARINE (zone dcfd...)
    'a0000001-0e50-b2b0-0000-000000000006'::UUID, -- PARMIGIANO (zone 38b9...)
    'a0000001-0e50-b2b0-0000-000000000007'::UUID, -- PROSCIUTTO (zone 38b9...)
    'a0000001-0e50-b2b0-0000-000000000008'::UUID  -- BURRATA (zone 38b9...)
  ];
  v_pid UUID;
  v_zone UUID;
  v_unit UUID;
  v_snap UUID;
  v_family TEXT;
BEGIN
  -- Create stock document for provisioning
  INSERT INTO stock_documents (
    establishment_id, organization_id, type, status,
    storage_zone_id, created_by, idempotency_key,
    posted_by, posted_at, lock_version
  ) VALUES (
    v_nonna_id, v_nonna_org, 'RECEIPT', 'POSTED',
    'dcfd334b-0b2e-4839-a8ae-b34cbd4efd7e', v_user_id,
    'test-provision-b2b-' || gen_random_uuid()::text,
    v_user_id, now(), 2
  ) RETURNING id INTO v_doc_id;

  -- Insert stock_document_lines + stock_events for each product
  FOREACH v_pid IN ARRAY v_products
  LOOP
    SELECT p.storage_zone_id, p.final_unit_id,
           CASE WHEN mu.category = 'base' THEN mu.family ELSE 'count' END
    INTO v_zone, v_unit, v_family
    FROM products_v2 p
    JOIN measurement_units mu ON mu.id = p.final_unit_id
    WHERE p.id = v_pid;

    SELECT zss.snapshot_version_id INTO v_snap
    FROM zone_stock_snapshots zss
    WHERE zss.establishment_id = v_nonna_id AND zss.storage_zone_id = v_zone;

    INSERT INTO stock_document_lines (
      document_id, product_id, delta_quantity_canonical,
      canonical_unit_id, canonical_family, context_hash
    ) VALUES (
      v_doc_id, v_pid, 100,
      v_unit, COALESCE(v_family, 'mass'), 'test-provision'
    );

    INSERT INTO stock_events (
      establishment_id, organization_id, storage_zone_id, product_id,
      document_id, event_type, event_reason,
      delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label,
      context_hash, snapshot_version_id,
      override_flag, posted_by
    ) VALUES (
      v_nonna_id, v_nonna_org, v_zone, v_pid,
      v_doc_id, 'RECEIPT', 'INITIAL_STOCK',
      100, v_unit, COALESCE(v_family, 'mass'), '',
      'test-provision', v_snap,
      false, v_user_id
    );
  END LOOP;
END;
$$;
