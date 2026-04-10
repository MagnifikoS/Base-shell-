
-- 1. Add org_type column to organizations (nullable, zero impact on AMIR)
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS org_type text;

-- 2. Create table for storing module selections per establishment (wizard)
CREATE TABLE IF NOT EXISTS public.platform_establishment_module_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(establishment_id, module_key)
);

ALTER TABLE public.platform_establishment_module_selections ENABLE ROW LEVEL SECURITY;

-- Only platform admins can manage these selections
CREATE POLICY "platform_admins_full_access" ON public.platform_establishment_module_selections
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- 3. Create the wizard RPC
CREATE OR REPLACE FUNCTION public.platform_create_organization_wizard(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_est_id uuid;
  v_org_name text;
  v_org_type text;
  v_est_name text;
  v_est_type text;
  v_profile jsonb;
  v_modules jsonb;
  v_mod record;
BEGIN
  -- Guard: platform admin only
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN';
  END IF;

  -- Extract payload
  v_org_name := p_payload->>'org_name';
  v_org_type := p_payload->>'org_type';
  v_est_name := p_payload->>'est_name';
  v_est_type := COALESCE(p_payload->>'est_type', 'restaurant');
  v_profile := p_payload->'profile';
  v_modules := p_payload->'modules';

  -- Validate required fields
  IF v_org_name IS NULL OR TRIM(v_org_name) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORG_NAME_REQUIRED');
  END IF;
  IF v_est_name IS NULL OR TRIM(v_est_name) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EST_NAME_REQUIRED');
  END IF;

  -- 1. Create organization
  INSERT INTO organizations (name, org_type)
  VALUES (TRIM(v_org_name), NULLIF(TRIM(v_org_type), ''))
  RETURNING id INTO v_org_id;

  -- 2. Create establishment
  INSERT INTO establishments (name, organization_id, establishment_type, status)
  VALUES (TRIM(v_est_name), v_org_id, v_est_type, 'active')
  RETURNING id INTO v_est_id;

  -- 3. Create establishment profile (fiche officielle)
  INSERT INTO establishment_profiles (
    establishment_id,
    establishment_type,
    legal_name,
    siret,
    contact_name,
    contact_email,
    contact_phone,
    address_line1,
    address_line2,
    postal_code,
    city,
    country,
    logo_url
  ) VALUES (
    v_est_id,
    v_est_type,
    NULLIF(TRIM(v_profile->>'legal_name'), ''),
    NULLIF(TRIM(v_profile->>'siret'), ''),
    NULLIF(TRIM(v_profile->>'contact_name'), ''),
    NULLIF(TRIM(v_profile->>'contact_email'), ''),
    NULLIF(TRIM(v_profile->>'contact_phone'), ''),
    NULLIF(TRIM(v_profile->>'address_line1'), ''),
    NULLIF(TRIM(v_profile->>'address_line2'), ''),
    NULLIF(TRIM(v_profile->>'postal_code'), ''),
    NULLIF(TRIM(v_profile->>'city'), ''),
    COALESCE(NULLIF(TRIM(v_profile->>'country'), ''), 'FR'),
    NULLIF(TRIM(v_profile->>'logo_url'), '')
  );

  -- 4. Store module selections
  IF v_modules IS NOT NULL AND jsonb_typeof(v_modules) = 'array' THEN
    FOR v_mod IN SELECT jsonb_array_elements_text(v_modules) AS key
    LOOP
      INSERT INTO platform_establishment_module_selections (establishment_id, module_key, enabled)
      VALUES (v_est_id, v_mod.key, true)
      ON CONFLICT (establishment_id, module_key) DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', v_org_id,
    'establishment_id', v_est_id
  );
END;
$$;
