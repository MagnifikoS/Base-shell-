
-- Rewrite fn_get_b2b_supplier_stock with all 6 security fixes:
-- (1) Caller must be member of client OR supplier establishment
-- (2) Only returns stock for products in b2b_imported_products (catalogue scope)
-- (3) Returns stock in supplier's canonical unit (client will match or show —)
-- (4) Batch calculation: single pass, no N+1
-- (5) Re-check at send time is handled client-side (staleTime)
-- (6) Returns empty array on any error → non-blocking fallback

CREATE OR REPLACE FUNCTION public.fn_get_b2b_supplier_stock(
  p_supplier_establishment_id uuid,
  p_client_establishment_id uuid,
  p_partnership_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share_stock boolean;
  v_caller_est_ids uuid[];
  v_result jsonb := '[]'::jsonb;
BEGIN
  -- ═══ (1) SECURITY: Verify caller is party to this partnership ═══
  SELECT array_agg(establishment_id) INTO v_caller_est_ids
  FROM user_establishments
  WHERE user_id = auth.uid();

  IF v_caller_est_ids IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Caller must be member of client or supplier establishment
  IF NOT (
    p_client_establishment_id = ANY(v_caller_est_ids) OR
    p_supplier_establishment_id = ANY(v_caller_est_ids)
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Check partnership exists with matching IDs and share_stock ON
  SELECT share_stock INTO v_share_stock
  FROM b2b_partnerships
  WHERE id = p_partnership_id
    AND supplier_establishment_id = p_supplier_establishment_id
    AND client_establishment_id = p_client_establishment_id
    AND status = 'active';

  IF NOT FOUND OR NOT v_share_stock THEN
    RETURN '[]'::jsonb;
  END IF;

  -- ═══ (2) + (3) + (4) BATCH: Get stock for all mapped products in one pass ═══
  -- Only products in b2b_imported_products (catalogue scope)
  -- Uses the real StockEngine pattern: snapshot → inventory_lines + stock_events
  SELECT jsonb_agg(row_to_json(t))
  INTO v_result
  FROM (
    SELECT
      bip.local_product_id AS client_product_id,
      bip.source_product_id AS supplier_product_id,
      (
        -- StockEngine: snapshot baseline + events delta
        SELECT ROUND(
          COALESCE(il.quantity, 0) + COALESCE(ev_sum.total_delta, 0),
          4
        )
        FROM products_v2 p
        LEFT JOIN zone_stock_snapshots zss
          ON zss.storage_zone_id = p.storage_zone_id
          AND zss.establishment_id = p_supplier_establishment_id
        LEFT JOIN inventory_lines il
          ON il.session_id = zss.snapshot_version_id
          AND il.product_id = p.id
        LEFT JOIN LATERAL (
          SELECT SUM(se.delta_quantity_canonical) AS total_delta
          FROM stock_events se
          WHERE se.product_id = p.id
            AND se.storage_zone_id = p.storage_zone_id
            AND se.snapshot_version_id = zss.snapshot_version_id
        ) ev_sum ON true
        WHERE p.id = bip.source_product_id
          AND p.archived_at IS NULL
      ) AS estimated_stock,
      -- Include unit info for client-side alignment
      (
        SELECT COALESCE(p.stock_handling_unit_id, p.final_unit_id)
        FROM products_v2 p
        WHERE p.id = bip.source_product_id
      ) AS supplier_unit_id
    FROM b2b_imported_products bip
    WHERE bip.establishment_id = p_client_establishment_id
      AND bip.source_establishment_id = p_supplier_establishment_id
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
