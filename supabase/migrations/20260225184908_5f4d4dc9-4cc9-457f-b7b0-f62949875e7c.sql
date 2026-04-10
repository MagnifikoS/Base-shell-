
-- ═══════════════════════════════════════════════════════════════════════════
-- F1 FIX: Add user_belongs_to_establishment check to get_imported_supplier_products
-- F2 FIX: Add status='active' filter to get_linked_establishment_profiles
-- F3 FIX: Support 'terminated' status in supplier_clients validation trigger
-- NEW: RPC resolve_supplier_products_for_shipment (cross-org shipment mapping)
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ F1: Fix get_imported_supplier_products — add caller verification ═══
CREATE OR REPLACE FUNCTION public.get_imported_supplier_products(
  p_client_establishment_id UUID,
  p_supplier_establishment_id UUID
)
RETURNS TABLE (
  id UUID,
  nom_produit TEXT,
  category TEXT,
  storage_zone_id UUID,
  storage_zone_name TEXT,
  stock_handling_unit_id UUID,
  final_unit_id UUID,
  delivery_unit_id UUID,
  supplier_billing_unit_id UUID,
  conditionnement_config JSONB,
  code_produit TEXT,
  final_unit_price NUMERIC,
  info_produit TEXT,
  supplier_billing_unit TEXT,
  final_unit TEXT,
  conditionnement_resume TEXT,
  kitchen_unit_id UUID,
  price_display_unit_id UUID,
  min_stock_quantity_canonical NUMERIC,
  min_stock_unit_id UUID,
  code_barres TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- F1 FIX: Verify caller belongs to the client establishment
  IF NOT public.user_belongs_to_establishment(auth.uid(), p_client_establishment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: caller not in client establishment';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM supplier_clients sc
    WHERE sc.supplier_establishment_id = p_supplier_establishment_id
      AND sc.client_establishment_id = p_client_establishment_id
      AND sc.status = 'active'
  ) THEN
    RAISE EXCEPTION 'No active partnership';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.nom_produit,
    p.category,
    p.storage_zone_id,
    sz.name AS storage_zone_name,
    p.stock_handling_unit_id,
    p.final_unit_id,
    p.delivery_unit_id,
    p.supplier_billing_unit_id,
    p.conditionnement_config,
    p.code_produit,
    p.final_unit_price,
    p.info_produit,
    p.supplier_billing_unit,
    p.final_unit,
    p.conditionnement_resume,
    p.kitchen_unit_id,
    p.price_display_unit_id,
    p.min_stock_quantity_canonical,
    p.min_stock_unit_id,
    p.code_barres
  FROM products_v2 p
  LEFT JOIN storage_zones sz ON sz.id = p.storage_zone_id
  INNER JOIN invoice_suppliers isup ON isup.id = p.supplier_id
  WHERE p.establishment_id = p_client_establishment_id
    AND p.archived_at IS NULL
    AND isup.partner_establishment_id = p_supplier_establishment_id
  ORDER BY p.nom_produit;
END;
$$;

-- ═══ F2: Fix get_linked_establishment_profiles — filter by status='active' ═══
CREATE OR REPLACE FUNCTION public.get_linked_establishment_profiles(
  p_my_establishment_id uuid,
  p_direction text DEFAULT 'clients'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_results jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.user_belongs_to_establishment(v_user_id, p_my_establishment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF p_direction = 'clients' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'supplier_client_id', sc.id,
      'establishment_id', sc.client_establishment_id,
      'status', sc.status,
      'created_at', sc.created_at,
      'name', e.name,
      'trade_name', e.trade_name,
      'establishment_type', COALESCE(ep.establishment_type, e.establishment_type),
      'legal_name', ep.legal_name,
      'logo_url', ep.logo_url,
      'contact_email', COALESCE(ep.contact_email, e.contact_email),
      'contact_name', ep.contact_name,
      'contact_phone', ep.contact_phone,
      'city', ep.city,
      'postal_code', ep.postal_code,
      'address_line1', ep.address_line1,
      'siret', ep.siret
    ) ORDER BY sc.created_at DESC), '[]'::jsonb)
    INTO v_results
    FROM supplier_clients sc
    JOIN establishments e ON e.id = sc.client_establishment_id
    LEFT JOIN establishment_profiles ep ON ep.establishment_id = sc.client_establishment_id
    WHERE sc.supplier_establishment_id = p_my_establishment_id
      AND sc.status = 'active';

  ELSIF p_direction = 'suppliers' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'supplier_client_id', sc.id,
      'establishment_id', sc.supplier_establishment_id,
      'status', sc.status,
      'created_at', sc.created_at,
      'name', e.name,
      'trade_name', e.trade_name,
      'establishment_type', COALESCE(ep.establishment_type, e.establishment_type),
      'legal_name', ep.legal_name,
      'logo_url', ep.logo_url,
      'contact_email', COALESCE(ep.contact_email, e.contact_email),
      'contact_name', ep.contact_name,
      'contact_phone', ep.contact_phone,
      'city', ep.city,
      'postal_code', ep.postal_code,
      'address_line1', ep.address_line1,
      'siret', ep.siret
    ) ORDER BY sc.created_at DESC), '[]'::jsonb)
    INTO v_results
    FROM supplier_clients sc
    JOIN establishments e ON e.id = sc.supplier_establishment_id
    LEFT JOIN establishment_profiles ep ON ep.establishment_id = sc.supplier_establishment_id
    WHERE sc.client_establishment_id = p_my_establishment_id
      AND sc.status = 'active';

  ELSE
    RAISE EXCEPTION 'INVALID_DIRECTION: must be clients or suppliers';
  END IF;

  RETURN v_results;
END;
$$;

-- ═══ F3: Fix fn_supplier_client_validate — support 'terminated' status ═══
CREATE OR REPLACE FUNCTION public.fn_supplier_client_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('active', 'suspended', 'terminated') THEN
    RAISE EXCEPTION 'Invalid supplier_client status: %', NEW.status;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ═══ NEW: RPC to resolve supplier's own products for cross-org shipment ═══
-- Given client product IDs from an order, maps them back to the supplier's
-- own products_v2 using code_produit (priority) then nom_produit fallback.
-- This allows the supplier to create a WITHDRAWAL from THEIR OWN stock.
CREATE OR REPLACE FUNCTION public.resolve_supplier_products_for_shipment(
  p_supplier_establishment_id UUID,
  p_client_product_ids UUID[]
)
RETURNS TABLE (
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
  -- Verify caller belongs to the supplier establishment
  IF NOT public.user_belongs_to_establishment(auth.uid(), p_supplier_establishment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: caller not in supplier establishment';
  END IF;

  RETURN QUERY
  WITH client_products AS (
    -- Read client product metadata (bypasses RLS via SECURITY DEFINER)
    SELECT cp.id AS cp_id, cp.code_produit AS cp_code, cp.nom_produit AS cp_name
    FROM products_v2 cp
    WHERE cp.id = ANY(p_client_product_ids)
      AND cp.archived_at IS NULL
  ),
  supplier_products AS (
    SELECT sp.id AS sp_id, sp.code_produit AS sp_code, sp.nom_produit AS sp_name,
           sp.storage_zone_id, sp.stock_handling_unit_id, sp.final_unit_id,
           sp.supplier_billing_unit_id, sp.conditionnement_config
    FROM products_v2 sp
    WHERE sp.establishment_id = p_supplier_establishment_id
      AND sp.archived_at IS NULL
  ),
  -- Priority 1: Match by code_produit (exact, case-insensitive)
  code_matches AS (
    SELECT DISTINCT ON (cp.cp_id)
      cp.cp_id,
      sp.sp_id,
      sp.sp_name,
      sp.storage_zone_id,
      sp.stock_handling_unit_id,
      sp.final_unit_id,
      sp.supplier_billing_unit_id,
      sp.conditionnement_config,
      'code_produit'::TEXT AS matched_by
    FROM client_products cp
    JOIN supplier_products sp ON lower(trim(sp.sp_code)) = lower(trim(cp.cp_code))
    WHERE cp.cp_code IS NOT NULL AND cp.cp_code != ''
      AND sp.sp_code IS NOT NULL AND sp.sp_code != ''
    ORDER BY cp.cp_id, sp.sp_id
  ),
  -- Priority 2: Match by nom_produit (exact, case-insensitive) for unmatched
  name_matches AS (
    SELECT DISTINCT ON (cp.cp_id)
      cp.cp_id,
      sp.sp_id,
      sp.sp_name,
      sp.storage_zone_id,
      sp.stock_handling_unit_id,
      sp.final_unit_id,
      sp.supplier_billing_unit_id,
      sp.conditionnement_config,
      'nom_produit'::TEXT AS matched_by
    FROM client_products cp
    JOIN supplier_products sp ON lower(trim(sp.sp_name)) = lower(trim(cp.cp_name))
    WHERE NOT EXISTS (SELECT 1 FROM code_matches cm WHERE cm.cp_id = cp.cp_id)
    ORDER BY cp.cp_id, sp.sp_id
  )
  SELECT cp_id, sp_id, sp_name, storage_zone_id, stock_handling_unit_id, 
         final_unit_id, supplier_billing_unit_id, conditionnement_config, matched_by
  FROM code_matches
  UNION ALL
  SELECT cp_id, sp_id, sp_name, storage_zone_id, stock_handling_unit_id, 
         final_unit_id, supplier_billing_unit_id, conditionnement_config, matched_by
  FROM name_matches;
END;
$$;
