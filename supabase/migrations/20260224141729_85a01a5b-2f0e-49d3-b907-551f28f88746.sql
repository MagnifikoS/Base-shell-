
-- ══════════════════════════════════════════════════════════════
-- PLATFORM: establishment_profiles + RPCs + Storage bucket
-- 100% additive — no existing table/function modified
-- ══════════════════════════════════════════════════════════════

-- 1. Table establishment_profiles
CREATE TABLE public.establishment_profiles (
  establishment_id UUID PRIMARY KEY REFERENCES public.establishments(id) ON DELETE CASCADE,
  establishment_type TEXT NOT NULL DEFAULT 'restaurant' CHECK (establishment_type IN ('restaurant', 'fournisseur')),
  legal_name TEXT,
  siret TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  postal_code TEXT,
  city TEXT,
  country TEXT NOT NULL DEFAULT 'FR',
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. RLS — ultra restrictive (platform admin only)
ALTER TABLE public.establishment_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admins_select_profiles"
  ON public.establishment_profiles
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY "platform_admins_insert_profiles"
  ON public.establishment_profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "platform_admins_update_profiles"
  ON public.establishment_profiles
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- 3. RPC: platform_get_establishment_profile
CREATE OR REPLACE FUNCTION public.platform_get_establishment_profile(p_establishment_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN';
  END IF;

  RETURN (
    SELECT COALESCE(
      row_to_json(ep)::jsonb,
      jsonb_build_object('establishment_id', p_establishment_id, 'exists', false)
    )
    FROM establishment_profiles ep
    WHERE ep.establishment_id = p_establishment_id
  );
END;
$$;

-- 4. RPC: platform_upsert_establishment_profile
CREATE OR REPLACE FUNCTION public.platform_upsert_establishment_profile(
  p_establishment_id UUID,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID;
BEGIN
  _caller := auth.uid();
  IF _caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF NOT public.is_platform_admin(_caller) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_PLATFORM_ADMIN');
  END IF;

  -- Verify establishment exists
  IF NOT EXISTS (SELECT 1 FROM establishments WHERE id = p_establishment_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ESTABLISHMENT_NOT_FOUND');
  END IF;

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
    logo_url,
    updated_at
  ) VALUES (
    p_establishment_id,
    COALESCE(p_payload->>'establishment_type', 'restaurant'),
    p_payload->>'legal_name',
    p_payload->>'siret',
    p_payload->>'contact_name',
    p_payload->>'contact_email',
    p_payload->>'contact_phone',
    p_payload->>'address_line1',
    p_payload->>'address_line2',
    p_payload->>'postal_code',
    p_payload->>'city',
    COALESCE(p_payload->>'country', 'FR'),
    p_payload->>'logo_url',
    now()
  )
  ON CONFLICT (establishment_id) DO UPDATE SET
    establishment_type = COALESCE(EXCLUDED.establishment_type, establishment_profiles.establishment_type),
    legal_name = EXCLUDED.legal_name,
    siret = EXCLUDED.siret,
    contact_name = EXCLUDED.contact_name,
    contact_email = EXCLUDED.contact_email,
    contact_phone = EXCLUDED.contact_phone,
    address_line1 = EXCLUDED.address_line1,
    address_line2 = EXCLUDED.address_line2,
    postal_code = EXCLUDED.postal_code,
    city = EXCLUDED.city,
    country = COALESCE(EXCLUDED.country, establishment_profiles.country),
    logo_url = EXCLUDED.logo_url,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 5. Storage bucket for establishment logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('establishment-logos', 'establishment-logos', true)
ON CONFLICT (id) DO NOTHING;

-- 6. Storage RLS: platform admins can upload
CREATE POLICY "platform_admins_upload_logos"
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'establishment-logos'
    AND public.is_platform_admin(auth.uid())
  );

CREATE POLICY "platform_admins_update_logos"
  ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'establishment-logos'
    AND public.is_platform_admin(auth.uid())
  );

CREATE POLICY "public_read_logos"
  ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'establishment-logos');
