
-- New scoped RPC: resolve_client_products_for_reception_v2
-- Input: order_id only (no free product ID list)
-- Extracts supplier_product_ids from BL retrait lines internally
-- Verifies caller belongs to the client establishment (source_establishment_id)
CREATE OR REPLACE FUNCTION public.resolve_client_products_for_reception_v2(
  p_order_id uuid
)
RETURNS TABLE(
  supplier_product_id uuid,
  client_product_id uuid,
  client_product_name text,
  matched_by text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_client_establishment_id UUID;
  v_supplier_product_ids UUID[];
BEGIN
  -- Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Load order
  SELECT po.id, po.source_establishment_id, po.destination_establishment_id, po.bl_retrait_document_id
  INTO v_order
  FROM product_orders po
  WHERE po.id = p_order_id;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  -- In B2B orders, source = client (buyer), destination = supplier
  v_client_establishment_id := v_order.source_establishment_id;

  -- Verify caller belongs to client establishment
  IF NOT public.user_belongs_to_establishment(auth.uid(), v_client_establishment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: caller not in client establishment';
  END IF;

  -- Extract supplier product IDs from BL retrait lines
  IF v_order.bl_retrait_document_id IS NULL THEN
    RAISE EXCEPTION 'NO_BL_RETRAIT: order has no BL retrait';
  END IF;

  SELECT ARRAY_AGG(bwl.product_id)
  INTO v_supplier_product_ids
  FROM bl_withdrawal_lines bwl
  WHERE bwl.bl_withdrawal_document_id = v_order.bl_retrait_document_id;

  IF v_supplier_product_ids IS NULL OR array_length(v_supplier_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_BL_LINES: BL retrait has no lines';
  END IF;

  -- Run the same 3-strategy matching as V1, but with internally-extracted IDs
  RETURN QUERY
  WITH
  -- Strategy 1 (SSOT): Client product's source_product_id points to supplier product
  source_matches AS (
    SELECT DISTINCT ON (sp_id)
      sp_id,
      cp.id AS cp_id,
      cp.nom_produit::TEXT AS cp_name,
      'source_product_id'::TEXT AS match_method
    FROM unnest(v_supplier_product_ids) AS sp_id
    JOIN products_v2 cp
      ON cp.source_product_id = sp_id
      AND cp.establishment_id = v_client_establishment_id
      AND cp.archived_at IS NULL
    ORDER BY sp_id, cp.created_at ASC
  ),
  -- Strategy 2 (Legacy): Same UUID
  uuid_matches AS (
    SELECT DISTINCT ON (sp_id)
      sp_id,
      cp.id AS cp_id,
      cp.nom_produit::TEXT AS cp_name,
      'same_uuid'::TEXT AS match_method
    FROM unnest(v_supplier_product_ids) AS sp_id
    JOIN products_v2 cp
      ON cp.id = sp_id
      AND cp.establishment_id = v_client_establishment_id
      AND cp.archived_at IS NULL
    WHERE NOT EXISTS (SELECT 1 FROM source_matches sm WHERE sm.sp_id = uuid_matches.sp_id)
    ORDER BY sp_id, cp.created_at ASC
  ),
  -- Strategy 3 (Reverse-link): Supplier product's source_product_id points to client product
  reverse_matches AS (
    SELECT DISTINCT ON (sp.id)
      sp.id AS sp_id,
      cp.id AS cp_id,
      cp.nom_produit::TEXT AS cp_name,
      'reverse_link'::TEXT AS match_method
    FROM unnest(v_supplier_product_ids) AS target_id
    JOIN products_v2 sp ON sp.id = target_id AND sp.source_product_id IS NOT NULL
    JOIN products_v2 cp
      ON cp.id = sp.source_product_id
      AND cp.establishment_id = v_client_establishment_id
      AND cp.archived_at IS NULL
    WHERE NOT EXISTS (SELECT 1 FROM source_matches sm WHERE sm.sp_id = sp.id)
      AND NOT EXISTS (SELECT 1 FROM uuid_matches um WHERE um.sp_id = sp.id)
    ORDER BY sp.id, cp.created_at ASC
  )
  SELECT sm.sp_id, sm.cp_id, sm.cp_name, sm.match_method FROM source_matches sm
  UNION ALL
  SELECT um.sp_id, um.cp_id, um.cp_name, um.match_method FROM uuid_matches um
  UNION ALL
  SELECT rm.sp_id, rm.cp_id, rm.cp_name, rm.match_method FROM reverse_matches rm;
END;
$function$;
