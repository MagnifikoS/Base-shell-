
-- ═══════════════════════════════════════════════════════════════════
-- RPC: get_linked_establishment_profiles
-- Returns establishment + profile data for establishments linked via supplier_clients.
-- SECURITY DEFINER: bypasses RLS to allow cross-org reads only for linked pairs.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_linked_establishment_profiles(
  p_my_establishment_id uuid,
  p_direction text DEFAULT 'clients' -- 'clients' or 'suppliers'
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

  -- Verify caller belongs to the establishment
  IF NOT public.user_belongs_to_establishment(v_user_id, p_my_establishment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF p_direction = 'clients' THEN
    -- Supplier wants to see their clients' profiles
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
    WHERE sc.supplier_establishment_id = p_my_establishment_id;

  ELSIF p_direction = 'suppliers' THEN
    -- Restaurant wants to see their suppliers' profiles
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
    WHERE sc.client_establishment_id = p_my_establishment_id;

  ELSE
    RAISE EXCEPTION 'INVALID_DIRECTION: must be clients or suppliers';
  END IF;

  RETURN v_results;
END;
$$;
