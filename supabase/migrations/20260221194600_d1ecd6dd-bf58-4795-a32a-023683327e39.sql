
-- ═══════════════════════════════════════════════════════════════════════
-- FULL PRODUCT DUPLICATION: LaBaja → Magnifiko (214 products)
-- Fixed: created_via for inventory lines guard
-- ═══════════════════════════════════════════════════════════════════════

-- 1. CLEANUP
ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_delete;
ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_update;
DELETE FROM stock_events WHERE establishment_id = 'e9c3dccf-bee3-46c0-b068-52e05c18d883';
ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_delete;
ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_update;

DELETE FROM stock_document_lines WHERE document_id IN (
  SELECT id FROM stock_documents WHERE establishment_id = 'e9c3dccf-bee3-46c0-b068-52e05c18d883'
);
DELETE FROM stock_documents WHERE establishment_id = 'e9c3dccf-bee3-46c0-b068-52e05c18d883';
DELETE FROM inventory_lines WHERE session_id IN (
  SELECT id FROM inventory_sessions WHERE establishment_id = 'e9c3dccf-bee3-46c0-b068-52e05c18d883'
);
DELETE FROM zone_stock_snapshots WHERE establishment_id = 'e9c3dccf-bee3-46c0-b068-52e05c18d883';
DELETE FROM inventory_sessions WHERE establishment_id = 'e9c3dccf-bee3-46c0-b068-52e05c18d883';
DELETE FROM inventory_zone_products WHERE establishment_id = 'e9c3dccf-bee3-46c0-b068-52e05c18d883';
DELETE FROM products_v2 WHERE establishment_id = 'e9c3dccf-bee3-46c0-b068-52e05c18d883';

-- 2. Unit remap helpers
CREATE OR REPLACE FUNCTION pg_temp.remap_unit(src uuid) RETURNS uuid AS $$
BEGIN
  RETURN CASE src
    WHEN '1d253fa1-22fb-4dc3-acba-293119aa8057' THEN '100978f3-3e0d-437c-89ac-23d7a9fd6738'
    WHEN '8d28c96b-eca8-423a-8034-5abd37bd6e48' THEN '0acf2a5f-5ea4-48c5-8fee-e91a587eab53'
    WHEN '646a4c04-e984-4c08-8d79-ecd21b908925' THEN 'f1c2eb78-4f8c-4d01-b958-986ef58afe40'
    WHEN '3902352b-c735-431e-8ecc-cba3a6b31e1e' THEN 'be5d064e-9860-45c6-9049-af88e77436c7'
    WHEN '0d2550fd-98ba-48ab-92a2-233a2da40c92' THEN '824ee66f-97ab-420a-a7c3-db2b938f4589'
    WHEN '5953b493-85b0-4a20-ace3-9a00d65d69f2' THEN 'c6fe7fbd-f18c-4743-845e-ebf588d8d1cb'
    WHEN '6e1a59c9-03a6-4512-baa7-4d62efe8bfd8' THEN 'd30f20eb-23a5-43c1-a62f-433e51c3533f'
    WHEN '00429441-544e-4933-b3f5-9851678951af' THEN 'ff3c8bb6-7e0b-40ec-8880-5b74595d3d1c'
    WHEN 'cf2e8b31-a30e-432b-8655-b99d665eb5fc' THEN '9f30f66c-75d9-4123-8ab0-5487152452f3'
    WHEN '8446b606-84f8-4143-8508-8aab4a7ff0c1' THEN '06dc2476-92f8-4fb5-812e-65bccfb9e5e3'
    WHEN 'a1038bca-c91d-43e8-9904-ff3d0f83ff05' THEN 'bba6ca4c-4300-486d-a25f-40ba3b9f5d9b'
    WHEN '554da63c-3a7e-4a1c-a176-7a2c86ff5f44' THEN '22408ee3-c663-403c-877e-943f8bb52c0f'
    WHEN 'e1d5f3c4-eeab-4c62-9187-5520c6c393d5' THEN 'f6acc619-b2f3-4d30-b54d-ca48606c4bf0'
    WHEN 'e061cf92-1dbc-4c98-ad2f-1884b21e17ff' THEN '02f610ef-0e90-4fd1-80cd-000e3c4112e8'
    WHEN 'c7551abf-6970-40a1-874c-091df2c2cf88' THEN 'c3b46d02-aa09-4465-bfd5-1eb6c21a4e39'
    WHEN '36d4f437-0326-44ce-8cf8-f13731e0ac93' THEN '9d724df5-cfcb-419e-b9eb-a7870aac7f3d'
    WHEN '36586aee-e2ef-4ccc-bdfa-9616fd29dbab' THEN '93f63d30-a69d-4375-a0d2-472a39a31b85'
    WHEN '78e7047b-ed66-4acc-9995-6436f33c22e3' THEN '3a15c389-4fdd-4c53-ad89-87021a1afdf8'
    WHEN 'b4d55d47-8ea6-411e-ad52-04a6287716c3' THEN 'fe61c2ae-fe06-41b5-a9b6-ebc7b951e0a9'
    WHEN 'b613ddd1-4731-4555-ba3d-1453578db868' THEN '52ba0538-b4f6-43e6-8713-4a355aeca3f0'
    ELSE src
  END;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.remap_json(src jsonb) RETURNS jsonb AS $$
DECLARE txt text;
BEGIN
  IF src IS NULL THEN RETURN NULL; END IF;
  txt := src::text;
  txt := replace(txt, '1d253fa1-22fb-4dc3-acba-293119aa8057', '100978f3-3e0d-437c-89ac-23d7a9fd6738');
  txt := replace(txt, '8d28c96b-eca8-423a-8034-5abd37bd6e48', '0acf2a5f-5ea4-48c5-8fee-e91a587eab53');
  txt := replace(txt, '646a4c04-e984-4c08-8d79-ecd21b908925', 'f1c2eb78-4f8c-4d01-b958-986ef58afe40');
  txt := replace(txt, '3902352b-c735-431e-8ecc-cba3a6b31e1e', 'be5d064e-9860-45c6-9049-af88e77436c7');
  txt := replace(txt, '0d2550fd-98ba-48ab-92a2-233a2da40c92', '824ee66f-97ab-420a-a7c3-db2b938f4589');
  txt := replace(txt, '5953b493-85b0-4a20-ace3-9a00d65d69f2', 'c6fe7fbd-f18c-4743-845e-ebf588d8d1cb');
  txt := replace(txt, '6e1a59c9-03a6-4512-baa7-4d62efe8bfd8', 'd30f20eb-23a5-43c1-a62f-433e51c3533f');
  txt := replace(txt, '00429441-544e-4933-b3f5-9851678951af', 'ff3c8bb6-7e0b-40ec-8880-5b74595d3d1c');
  txt := replace(txt, 'cf2e8b31-a30e-432b-8655-b99d665eb5fc', '9f30f66c-75d9-4123-8ab0-5487152452f3');
  txt := replace(txt, '8446b606-84f8-4143-8508-8aab4a7ff0c1', '06dc2476-92f8-4fb5-812e-65bccfb9e5e3');
  txt := replace(txt, 'a1038bca-c91d-43e8-9904-ff3d0f83ff05', 'bba6ca4c-4300-486d-a25f-40ba3b9f5d9b');
  txt := replace(txt, '554da63c-3a7e-4a1c-a176-7a2c86ff5f44', '22408ee3-c663-403c-877e-943f8bb52c0f');
  txt := replace(txt, 'e1d5f3c4-eeab-4c62-9187-5520c6c393d5', 'f6acc619-b2f3-4d30-b54d-ca48606c4bf0');
  txt := replace(txt, 'e061cf92-1dbc-4c98-ad2f-1884b21e17ff', '02f610ef-0e90-4fd1-80cd-000e3c4112e8');
  txt := replace(txt, 'c7551abf-6970-40a1-874c-091df2c2cf88', 'c3b46d02-aa09-4465-bfd5-1eb6c21a4e39');
  txt := replace(txt, '36d4f437-0326-44ce-8cf8-f13731e0ac93', '9d724df5-cfcb-419e-b9eb-a7870aac7f3d');
  txt := replace(txt, '36586aee-e2ef-4ccc-bdfa-9616fd29dbab', '93f63d30-a69d-4375-a0d2-472a39a31b85');
  txt := replace(txt, '78e7047b-ed66-4acc-9995-6436f33c22e3', '3a15c389-4fdd-4c53-ad89-87021a1afdf8');
  txt := replace(txt, 'b4d55d47-8ea6-411e-ad52-04a6287716c3', 'fe61c2ae-fe06-41b5-a9b6-ebc7b951e0a9');
  txt := replace(txt, 'b613ddd1-4731-4555-ba3d-1453578db868', '52ba0538-b4f6-43e6-8713-4a355aeca3f0');
  RETURN txt::jsonb;
END;
$$ LANGUAGE plpgsql;

-- 3. INSERT 214 products
INSERT INTO products_v2 (
  id, establishment_id, code_produit, code_barres, nom_produit, nom_produit_fr,
  name_normalized, variant_format, category, supplier_name,
  conditionnement_config, conditionnement_resume,
  final_unit_price, final_unit, info_produit,
  supplier_billing_unit, supplier_id, storage_zone_id,
  final_unit_id, supplier_billing_unit_id, stock_handling_unit_id,
  kitchen_unit_id, delivery_unit_id, price_display_unit_id,
  inventory_display_unit_id, min_stock_quantity_canonical, min_stock_unit_id,
  reception_tolerance_min, reception_tolerance_max, reception_tolerance_unit_id,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'e9c3dccf-bee3-46c0-b068-52e05c18d883'::uuid,
  code_produit, code_barres, nom_produit, nom_produit_fr,
  name_normalized, variant_format, category, supplier_name,
  pg_temp.remap_json(conditionnement_config), conditionnement_resume,
  final_unit_price, final_unit, info_produit, supplier_billing_unit,
  '3848e4d4-f67f-4df2-ac4b-08cbe901c48f'::uuid,
  '6b923a0c-4263-4cd2-b50e-5f8c849dc87c'::uuid,
  pg_temp.remap_unit(final_unit_id),
  pg_temp.remap_unit(supplier_billing_unit_id),
  pg_temp.remap_unit(stock_handling_unit_id),
  pg_temp.remap_unit(kitchen_unit_id),
  pg_temp.remap_unit(delivery_unit_id),
  pg_temp.remap_unit(price_display_unit_id),
  CASE WHEN inventory_display_unit_id IS NOT NULL THEN pg_temp.remap_unit(inventory_display_unit_id) END,
  min_stock_quantity_canonical,
  CASE WHEN min_stock_unit_id IS NOT NULL THEN pg_temp.remap_unit(min_stock_unit_id) END,
  reception_tolerance_min, reception_tolerance_max,
  CASE WHEN reception_tolerance_unit_id IS NOT NULL THEN pg_temp.remap_unit(reception_tolerance_unit_id) END,
  now(), now()
FROM products_v2
WHERE establishment_id = '9ac57795-0724-42a1-a555-f4b3bcbb2f22'
  AND archived_at IS NULL;

-- 4. Inventory session
INSERT INTO inventory_sessions (
  id, establishment_id, organization_id, storage_zone_id,
  started_by, started_at, status, completed_at,
  total_products, counted_products
) VALUES (
  'a0000001-0000-4000-8000-000000000214',
  'e9c3dccf-bee3-46c0-b068-52e05c18d883',
  'f056aae1-acb3-4209-949a-a0b399854061',
  '6b923a0c-4263-4cd2-b50e-5f8c849dc87c',
  '00000000-0000-0000-0000-000000000000',
  now(), 'termine', now(), 214, 214
);

-- 5. Inventory lines at 0 with created_via to pass guard trigger
INSERT INTO inventory_lines (session_id, product_id, quantity, unit_id, display_order, counted_at, counted_by, created_via)
SELECT
  'a0000001-0000-4000-8000-000000000214'::uuid,
  p.id, 0, p.stock_handling_unit_id,
  ROW_NUMBER() OVER (ORDER BY p.nom_produit),
  now(), '00000000-0000-0000-0000-000000000000',
  'INIT_AFTER_SNAPSHOT'
FROM products_v2 p
WHERE p.establishment_id = 'e9c3dccf-bee3-46c0-b068-52e05c18d883';

-- 6. Snapshot
INSERT INTO zone_stock_snapshots (
  establishment_id, organization_id, storage_zone_id, snapshot_version_id
) VALUES (
  'e9c3dccf-bee3-46c0-b068-52e05c18d883',
  'f056aae1-acb3-4209-949a-a0b399854061',
  '6b923a0c-4263-4cd2-b50e-5f8c849dc87c',
  'a0000001-0000-4000-8000-000000000214'
)
ON CONFLICT (establishment_id, storage_zone_id)
DO UPDATE SET snapshot_version_id = EXCLUDED.snapshot_version_id, updated_at = now();
