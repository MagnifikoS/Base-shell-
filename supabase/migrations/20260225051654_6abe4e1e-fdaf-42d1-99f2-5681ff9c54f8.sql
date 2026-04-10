
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TABLE: platform_unit_templates — bibliothèque d'unités standard plateforme
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.platform_unit_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  abbreviation text NOT NULL,
  category text NOT NULL DEFAULT 'base',
  family text,
  is_reference boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT true,
  usage_category text NOT NULL DEFAULT 'kitchen',
  display_order integer NOT NULL DEFAULT 0,
  aliases text[] DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_unit_templates ENABLE ROW LEVEL SECURITY;

-- Only platform admins can manage templates
CREATE POLICY "platform_admins_manage_unit_templates"
  ON public.platform_unit_templates
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- Read access for the wizard RPC (SECURITY DEFINER) — no extra policy needed

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. SEED: Snapshot des 27+ unités AMIR → platform_unit_templates
--    (one-shot, 0 impact AMIR, données figées)
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.platform_unit_templates (name, abbreviation, category, family, is_reference, is_system, usage_category, display_order, aliases) VALUES
  -- Base units
  ('Pièce',       'pce',   'base',      'count',  true,  true, 'kitchen', 1,  '{piece,pièce,pc,unite,unité,u}'),
  ('Kilogramme',  'kg',    'base',      'weight', true,  true, 'kitchen', 2,  '{kilo,kilogrammes}'),
  ('Gramme',      'g',     'base',      'weight', false, true, 'kitchen', 3,  '{grammes}'),
  ('Litre',       'L',     'base',      'volume', true,  true, 'kitchen', 4,  '{litre,litres,l}'),
  ('Millilitre',  'ml',    'base',      'volume', false, true, 'kitchen', 5,  '{millilitre,millilitres}'),
  ('Centilitre',  'cl',    'base',      'volume', false, true, 'kitchen', 6,  '{centilitre,centilitres}'),
  ('Unité',       'u',     'base',      'count',  false, true, 'recipe',  7,  '{}'),
  -- Packaging units
  ('Carton',      'car',   'packaging', 'count',  false, true, 'stock',   10, '{cartons}'),
  ('Colis',       'col',   'packaging', 'count',  false, true, 'stock',   11, '{colisage}'),
  ('Caisse',      'cais',  'packaging', 'count',  false, true, 'stock',   12, '{caisses}'),
  ('Pack',        'pack',  'packaging', 'count',  false, true, 'stock',   13, '{}'),
  ('Lot',         'lot',   'packaging', 'count',  false, true, 'stock',   14, '{}'),
  ('Palette',     'pal',   'packaging', 'count',  false, true, 'stock',   15, '{}'),
  ('Sac',         'sac',   'packaging', 'count',  false, true, 'stock',   16, '{}'),
  ('Fût',         'fut',   'packaging', 'count',  false, true, 'stock',   17, '{}'),
  ('Bidon',       'bid',   'packaging', 'count',  false, true, 'stock',   18, '{}'),
  ('Boîte',       'bte',   'packaging', 'count',  false, true, 'stock',   19, '{boite,boîtes}'),
  ('Pot',         'pot',   'packaging', 'count',  false, true, 'stock',   20, '{}'),
  ('Tube',        'tub',   'packaging', 'count',  false, true, 'stock',   21, '{}'),
  ('Canette',     'can',   'packaging', 'count',  false, true, 'stock',   22, '{canettes}'),
  ('Bouteille',   'bout',  'packaging', 'count',  false, true, 'stock',   23, '{bouteilles}'),
  ('Barquette',   'barq',  'packaging', 'count',  false, true, 'stock',   24, '{barquettes}'),
  ('Sachet',      'sach',  'packaging', 'count',  false, true, 'stock',   25, '{sachets}'),
  ('Poche',       'poche', 'packaging', 'count',  false, true, 'stock',   26, '{}'),
  ('Bac',         'bac',   'packaging', 'count',  false, true, 'stock',   27, '{}'),
  ('Seau',        'seau',  'packaging', 'count',  false, true, 'stock',   28, '{}'),
  ('Flacon',      'flac',  'packaging', 'count',  false, true, 'stock',   29, '{}'),
  ('Rouleau',     'roul',  'packaging', 'count',  false, true, 'stock',   30, '{}'),
  ('Paquet',      'paq',   'packaging', 'count',  false, true, 'stock',   31, '{}'),
  ('Plateau',     'plat',  'packaging', 'count',  false, true, 'stock',   32, '{}'),
  ('Portion',     'port',  'packaging', 'count',  false, true, 'stock',   33, '{}'),
  ('Dose',        'dose',  'packaging', 'count',  false, true, 'stock',   34, '{}'),
  ('Tranche',     'tr',    'packaging', 'count',  false, true, 'stock',   35, '{}'),
  ('Petite cuillère', 'cc', 'packaging', 'count', false, true, 'stock',   36, '{}'),
  ('Grande cuillère', 'cs', 'packaging', 'count', false, true, 'stock',   37, '{}');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. UPDATE WIZARD RPC: copie auto des templates → measurement_units
-- ═══════════════════════════════════════════════════════════════════════════
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

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', v_org_id,
    'establishment_id', v_est_id,
    'units_seeded', v_units_seeded
  );
END;
$$;
