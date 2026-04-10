
-- Add share_stock column to b2b_partnerships (default OFF = no change to existing behavior)
ALTER TABLE public.b2b_partnerships
  ADD COLUMN IF NOT EXISTS share_stock boolean NOT NULL DEFAULT false;

-- RPC: Get estimated stock for supplier products mapped via B2B
-- Read-only, uses StockEngine pattern: snapshot + events delta
-- Returns stock for products that the client has imported from this supplier
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
  v_result jsonb := '[]'::jsonb;
BEGIN
  -- Check if share_stock is ON for this partnership
  SELECT share_stock INTO v_share_stock
  FROM b2b_partnerships
  WHERE id = p_partnership_id
    AND supplier_establishment_id = p_supplier_establishment_id
    AND client_establishment_id = p_client_establishment_id
    AND status = 'active';

  IF NOT FOUND OR NOT v_share_stock THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Get stock for each mapped product
  -- source_product_id = supplier's product, local_product_id = client's product
  SELECT jsonb_agg(row_to_json(t))
  INTO v_result
  FROM (
    SELECT
      bip.local_product_id AS client_product_id,
      bip.source_product_id AS supplier_product_id,
      COALESCE(
        (
          SELECT zss.quantity_canonical + COALESCE(
            (
              SELECT SUM(se.delta_canonical)
              FROM stock_events se
              WHERE se.product_id = bip.source_product_id
                AND se.storage_zone_id = zss.storage_zone_id
                AND se.created_at > zss.snapshot_at
            ), 0
          )
          FROM zone_stock_snapshots zss
          WHERE zss.product_id = bip.source_product_id
            AND zss.is_active = true
          LIMIT 1
        ),
        NULL
      ) AS estimated_stock
    FROM b2b_imported_products bip
    WHERE bip.establishment_id = p_client_establishment_id
      AND bip.source_establishment_id = p_supplier_establishment_id
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
