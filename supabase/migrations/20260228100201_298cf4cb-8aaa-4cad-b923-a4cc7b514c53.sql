
-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: resolve_client_products_for_reception
-- 
-- Purpose: Given supplier product IDs (from BL retrait lines), resolve them
-- to client local product IDs. Used in B2B reception (Strategy 3).
-- 
-- Why: RLS blocks cross-org reads on products_v2. This SECURITY DEFINER
-- function bypasses RLS to read the supplier's source_product_id and match
-- it to the client's local product.
--
-- Strategies (in order):
-- 1. Client product has source_product_id = supplier_product_id (SSOT)
-- 2. Same UUID (legacy imports)
-- 3. Reverse-link: supplier_product.source_product_id = client_product.id
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_client_products_for_reception(
  p_client_establishment_id UUID,
  p_supplier_product_ids UUID[]
)
RETURNS TABLE (
  supplier_product_id UUID,
  client_product_id UUID,
  client_product_name TEXT,
  matched_by TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Verify caller belongs to the client establishment
  IF NOT public.user_belongs_to_establishment(auth.uid(), p_client_establishment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: caller not in client establishment';
  END IF;

  RETURN QUERY
  WITH
  -- Strategy 1 (SSOT): Client product's source_product_id points to supplier product
  source_matches AS (
    SELECT DISTINCT ON (sp_id)
      sp_id,
      cp.id AS cp_id,
      cp.nom_produit::TEXT AS cp_name,
      'source_product_id'::TEXT AS match_method
    FROM unnest(p_supplier_product_ids) AS sp_id
    JOIN products_v2 cp
      ON cp.source_product_id = sp_id
      AND cp.establishment_id = p_client_establishment_id
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
    FROM unnest(p_supplier_product_ids) AS sp_id
    JOIN products_v2 cp
      ON cp.id = sp_id
      AND cp.establishment_id = p_client_establishment_id
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
    FROM unnest(p_supplier_product_ids) AS target_id
    JOIN products_v2 sp ON sp.id = target_id AND sp.source_product_id IS NOT NULL
    JOIN products_v2 cp
      ON cp.id = sp.source_product_id
      AND cp.establishment_id = p_client_establishment_id
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
$$;
