
-- ═══════════════════════════════════════════════════════════════════════════
-- STORAGE ZONES: Add code column + block DELETE + seed in wizard
-- Additive only — 0 impact on AMIR
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add optional 'code' column (if not exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'storage_zones' AND column_name = 'code'
  ) THEN
    ALTER TABLE public.storage_zones ADD COLUMN code text;
  END IF;
END $$;

-- 2. Block DELETE on storage_zones (archive only, never hard delete)
CREATE OR REPLACE FUNCTION public.fn_storage_zones_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  RAISE EXCEPTION 'DELETE on storage_zones is forbidden. Use is_active=false to archive.';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_storage_zones_no_delete ON public.storage_zones;
CREATE TRIGGER trg_storage_zones_no_delete
  BEFORE DELETE ON public.storage_zones
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_storage_zones_no_delete();

-- 3. Update wizard RPC to seed default storage zones (idempotent)
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
  v_units_seeded int;
  v_zones_seeded int;
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
    establishment_id, establishment_type, legal_name, siret,
    contact_name, contact_email, contact_phone,
    address_line1, address_line2, postal_code, city, country, logo_url
  ) VALUES (
    v_est_id, v_est_type,
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

  -- 5. Seed measurement_units from platform templates
  INSERT INTO measurement_units (
    establishment_id, organization_id,
    name, abbreviation, category, family,
    is_reference, is_system, usage_category,
    display_order, aliases
  )
  SELECT
    v_est_id, v_org_id,
    t.name, t.abbreviation, t.category, t.family,
    t.is_reference, t.is_system, t.usage_category,
    t.display_order, t.aliases
  FROM platform_unit_templates t
  ORDER BY t.display_order;

  GET DIAGNOSTICS v_units_seeded = ROW_COUNT;

  -- 6. Seed default storage zones (idempotent: skip if name already exists)
  WITH default_zones(zname, zorder) AS (
    VALUES
      ('Réserve', 1),
      ('Chambre froide', 2),
      ('Congélateur', 3),
      ('Épicerie', 4),
      ('Bar / Boissons', 5),
      ('Préparation', 6)
  )
  INSERT INTO storage_zones (establishment_id, organization_id, name, name_normalized, display_order, is_active)
  SELECT v_est_id, v_org_id, dz.zname, LOWER(TRIM(dz.zname)), dz.zorder, true
  FROM default_zones dz
  WHERE NOT EXISTS (
    SELECT 1 FROM storage_zones sz
    WHERE sz.establishment_id = v_est_id
      AND sz.name_normalized = LOWER(TRIM(dz.zname))
  );

  GET DIAGNOSTICS v_zones_seeded = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', v_org_id,
    'establishment_id', v_est_id,
    'units_seeded', v_units_seeded,
    'zones_seeded', v_zones_seeded
  );
END;
$$;
