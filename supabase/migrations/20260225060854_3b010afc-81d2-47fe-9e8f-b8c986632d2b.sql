
-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: Categories templates + RLS fix suppliers/categories + wizard update
-- Additif uniquement — 0 impact sur AMIR
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ 1. Table template catégories (comme platform_unit_templates) ═══
CREATE TABLE IF NOT EXISTS public.platform_category_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_normalized text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_category_templates ENABLE ROW LEVEL SECURITY;

-- Lecture réservée aux platform admins
CREATE POLICY "platform_admins_select" ON public.platform_category_templates
  FOR SELECT USING (public.is_platform_admin(auth.uid()));

-- Seed des 14 catégories standard (basées sur AMIR)
INSERT INTO public.platform_category_templates (name, name_normalized, display_order) VALUES
  ('Boissons (soft)', 'boissons (soft)', 1),
  ('Boulangerie / Pâtisserie', 'boulangerie / pâtisserie', 2),
  ('Café / Thé', 'café / thé', 3),
  ('Charcuterie', 'charcuterie', 4),
  ('Condiments / Sauces', 'condiments / sauces', 5),
  ('Divers', 'divers', 6),
  ('Emballages', 'emballages', 7),
  ('Épicerie', 'épicerie', 8),
  ('Fruits & Légumes', 'fruits & légumes', 9),
  ('Hygiène / Entretien', 'hygiène / entretien', 10),
  ('Poissons & Fruits de mer', 'poissons & fruits de mer', 11),
  ('Produits laitiers', 'produits laitiers', 12),
  ('Surgelés', 'surgelés', 13),
  ('Viandes', 'viandes', 14)
ON CONFLICT DO NOTHING;

-- ═══ 2. RLS: invoice_suppliers lisible par modules produits/fournisseurs ═══
CREATE POLICY "Products users can view suppliers"
  ON public.invoice_suppliers FOR SELECT
  USING (has_module_access('produits'::text, 'read'::access_level, establishment_id));

CREATE POLICY "Fournisseurs users can view suppliers"
  ON public.invoice_suppliers FOR SELECT
  USING (has_module_access('fournisseurs'::text, 'read'::access_level, establishment_id));

-- ═══ 3. RLS: product_categories lisible par modules produits/inventaire ═══
CREATE POLICY "product_categories_select_produits"
  ON public.product_categories FOR SELECT
  USING (has_module_access('produits'::text, 'read'::access_level, establishment_id));

CREATE POLICY "product_categories_select_inventaire"
  ON public.product_categories FOR SELECT
  USING (has_module_access('inventaire'::text, 'read'::access_level, establishment_id));

-- ═══ 4. Mise à jour de la RPC wizard pour seeder les catégories ═══
CREATE OR REPLACE FUNCTION public.platform_create_organization_wizard(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_categories_seeded int;
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

  -- 6. Seed default storage zones (idempotent)
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

  -- 7. Seed product categories from platform templates (idempotent)
  INSERT INTO product_categories (establishment_id, organization_id, name, name_normalized)
  SELECT v_est_id, v_org_id, t.name, t.name_normalized
  FROM platform_category_templates t
  WHERE NOT EXISTS (
    SELECT 1 FROM product_categories pc
    WHERE pc.establishment_id = v_est_id
      AND pc.name_normalized = t.name_normalized
  );

  GET DIAGNOSTICS v_categories_seeded = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', v_org_id,
    'establishment_id', v_est_id,
    'units_seeded', v_units_seeded,
    'zones_seeded', v_zones_seeded,
    'categories_seeded', v_categories_seeded
  );
END;
$function$;
