
-- RPC to read supplier's product_input_config for B2B import
-- SECURITY DEFINER: bypasses RLS but validates B2B partnership
CREATE OR REPLACE FUNCTION public.fn_get_b2b_source_input_config(
  _source_product_id uuid,
  _source_establishment_id uuid,
  _client_establishment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_partnership_exists boolean;
BEGIN
  -- Validate: active B2B partnership must exist between supplier and client
  SELECT EXISTS(
    SELECT 1 FROM b2b_partnerships
    WHERE supplier_establishment_id = _source_establishment_id
      AND client_establishment_id = _client_establishment_id
      AND status = 'active'
  ) INTO v_partnership_exists;

  IF NOT v_partnership_exists THEN
    RETURN NULL;
  END IF;

  -- Fetch source product_input_config (internal_* fields only)
  SELECT jsonb_build_object(
    'internal_mode', pic.internal_mode,
    'internal_preferred_unit_id', pic.internal_preferred_unit_id,
    'internal_unit_chain', pic.internal_unit_chain
  )
  INTO v_result
  FROM product_input_config pic
  WHERE pic.product_id = _source_product_id
    AND pic.establishment_id = _source_establishment_id;

  RETURN v_result;
END;
$$;
