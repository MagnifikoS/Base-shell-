
-- ═══════════════════════════════════════════════════════════════════════════
-- P0 FIX: resolve_supplier_products_for_shipment — ID-only matching
--
-- BEFORE: Matched by code_produit then nom_produit (name-based fallback)
-- AFTER:  Match by source_product_id (SSOT traceability link), fallback
--         to same_uuid for legacy imports only. ZERO name matching.
--
-- Impact: commandeProduits (ship flow)
-- Risk: Medium — changes resolution logic for all B2B shipments
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_supplier_products_for_shipment(
  p_supplier_establishment_id UUID,
  p_client_product_ids UUID[]
)
RETURNS TABLE(
  client_product_id UUID,
  supplier_product_id UUID,
  supplier_product_name TEXT,
  supplier_storage_zone_id UUID,
  supplier_stock_handling_unit_id UUID,
  supplier_final_unit_id UUID,
  supplier_billing_unit_id UUID,
  supplier_conditionnement_config JSONB,
  matched_by TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Verify caller belongs to the supplier establishment
  IF NOT public.user_belongs_to_establishment(auth.uid(), p_supplier_establishment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: caller not in supplier establishment';
  END IF;

  RETURN QUERY
  WITH
  -- Strategy 1 (SSOT): Match via source_product_id
  -- Client product has source_product_id pointing to supplier's product UUID
  source_matches AS (
    SELECT DISTINCT ON (cp.id)
      cp.id  AS cp_id,
      sp.id  AS sp_id,
      sp.nom_produit::TEXT AS sp_name,
      sp.storage_zone_id,
      sp.stock_handling_unit_id,
      sp.final_unit_id,
      sp.supplier_billing_unit_id,
      sp.conditionnement_config,
      'source_product_id'::TEXT AS matched_by
    FROM products_v2 cp
    JOIN products_v2 sp
      ON cp.source_product_id = sp.id
      AND sp.establishment_id = p_supplier_establishment_id
      AND sp.archived_at IS NULL
    WHERE cp.id = ANY(p_client_product_ids)
      AND cp.archived_at IS NULL
      AND cp.source_product_id IS NOT NULL
    ORDER BY cp.id, sp.id
  ),
  -- Strategy 2 (Legacy): Same UUID — old imports that kept the supplier UUID
  uuid_matches AS (
    SELECT DISTINCT ON (cp.id)
      cp.id  AS cp_id,
      sp.id  AS sp_id,
      sp.nom_produit::TEXT AS sp_name,
      sp.storage_zone_id,
      sp.stock_handling_unit_id,
      sp.final_unit_id,
      sp.supplier_billing_unit_id,
      sp.conditionnement_config,
      'same_uuid'::TEXT AS matched_by
    FROM products_v2 cp
    JOIN products_v2 sp
      ON cp.id = sp.id
      AND sp.establishment_id = p_supplier_establishment_id
      AND sp.archived_at IS NULL
    WHERE cp.id = ANY(p_client_product_ids)
      AND cp.archived_at IS NULL
      AND cp.source_product_id IS NULL  -- only if no source_product_id (legacy)
      AND NOT EXISTS (
        SELECT 1 FROM source_matches sm WHERE sm.cp_id = cp.id
      )
    ORDER BY cp.id, sp.id
  )
  SELECT
    sm.cp_id,
    sm.sp_id,
    sm.sp_name,
    sm.storage_zone_id,
    sm.stock_handling_unit_id,
    sm.final_unit_id,
    sm.supplier_billing_unit_id,
    sm.conditionnement_config,
    sm.matched_by
  FROM source_matches sm

  UNION ALL

  SELECT
    um.cp_id,
    um.sp_id,
    um.sp_name,
    um.storage_zone_id,
    um.stock_handling_unit_id,
    um.final_unit_id,
    um.supplier_billing_unit_id,
    um.conditionnement_config,
    um.matched_by
  FROM uuid_matches um;
END;
$$;
