
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
  -- (1) SECURITY: Verify caller is party to this partnership
  SELECT array_agg(establishment_id) INTO v_caller_est_ids
  FROM user_establishments
  WHERE user_id = auth.uid();

  IF v_caller_est_ids IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT (
    p_client_establishment_id = ANY(v_caller_est_ids) OR
    p_supplier_establishment_id = ANY(v_caller_est_ids)
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Check partnership exists with share_stock ON
  SELECT share_stock INTO v_share_stock
  FROM b2b_partnerships
  WHERE id = p_partnership_id
    AND supplier_establishment_id = p_supplier_establishment_id
    AND client_establishment_id = p_client_establishment_id
    AND status = 'active';

  IF NOT FOUND OR NOT v_share_stock THEN
    RETURN '[]'::jsonb;
  END IF;

  -- (2) BATCH: Get stock for all mapped products
  -- If product is part of a mutualisation group, return aggregated stock (clamped per member)
  SELECT jsonb_agg(row_to_json(t))
  INTO v_result
  FROM (
    SELECT
      bip.local_product_id AS client_product_id,
      bip.source_product_id AS supplier_product_id,
      COALESCE(
        -- Try mutualised aggregate first
        (
          SELECT ROUND(SUM(GREATEST(0,
            COALESCE(il_m.quantity, 0) + COALESCE(ev_m.total_delta, 0)
          )), 4)
          FROM inventory_mutualisation_members imm
          INNER JOIN inventory_mutualisation_groups img
            ON img.id = imm.group_id
            AND img.establishment_id = p_supplier_establishment_id
          INNER JOIN inventory_mutualisation_members imm2
            ON imm2.group_id = img.id
          INNER JOIN products_v2 pm
            ON pm.id = imm2.product_id
            AND pm.archived_at IS NULL
          LEFT JOIN zone_stock_snapshots zss_m
            ON zss_m.storage_zone_id = pm.storage_zone_id
            AND zss_m.establishment_id = p_supplier_establishment_id
          LEFT JOIN inventory_lines il_m
            ON il_m.session_id = zss_m.snapshot_version_id
            AND il_m.product_id = pm.id
          LEFT JOIN LATERAL (
            SELECT SUM(se.delta_quantity_canonical) AS total_delta
            FROM stock_events se
            WHERE se.product_id = pm.id
              AND se.storage_zone_id = pm.storage_zone_id
              AND se.snapshot_version_id = zss_m.snapshot_version_id
          ) ev_m ON true
          WHERE imm.product_id = bip.source_product_id
        ),
        -- Fallback: individual product stock
        (
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
        )
      ) AS estimated_stock,
      -- Unit info
      (
        SELECT COALESCE(p.stock_handling_unit_id, p.final_unit_id)
        FROM products_v2 p
        WHERE p.id = bip.source_product_id
      ) AS supplier_unit_id,
      -- Unit abbreviation for display
      (
        SELECT mu.abbreviation
        FROM products_v2 p
        LEFT JOIN measurement_units mu ON mu.id = COALESCE(p.stock_handling_unit_id, p.final_unit_id)
        WHERE p.id = bip.source_product_id
      ) AS supplier_unit_label
    FROM b2b_imported_products bip
    WHERE bip.establishment_id = p_client_establishment_id
      AND bip.source_establishment_id = p_supplier_establishment_id
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
