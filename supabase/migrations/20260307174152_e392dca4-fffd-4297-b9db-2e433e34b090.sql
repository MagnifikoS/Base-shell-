
-- Batch-initialize all products that have zone + unit configured but no inventory_line
-- Uses the existing idempotent fn_initialize_product_stock RPC
DO $$
DECLARE
  r RECORD;
  v_result JSONB;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT p.id AS product_id
    FROM products_v2 p
    WHERE p.archived_at IS NULL
      AND p.storage_zone_id IS NOT NULL
      AND p.stock_handling_unit_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM zone_stock_snapshots zss
        JOIN inventory_lines il ON il.session_id = zss.snapshot_version_id
        WHERE zss.establishment_id = p.establishment_id
          AND zss.storage_zone_id = p.storage_zone_id
          AND il.product_id = p.id
      )
  LOOP
    v_result := fn_initialize_product_stock(r.product_id, '00000000-0000-0000-0000-000000000000'::uuid);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Initialized % products to stock 0', v_count;
END;
$$;
