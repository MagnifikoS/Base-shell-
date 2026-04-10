
-- PHASE 2 PILOT: Remap cross-tenant UUIDs in conditionnement_config for 5 live products
-- Each product has exactly 1 foreign UUID in priceLevel.billed_unit_id

-- Product 1: SEMOULE RIMACIN (Magnifiko) — 09a320f0 (NONNA kg) → 0acf2a5f (Magnifiko kg)
UPDATE products_v2
SET conditionnement_config = jsonb_set(
  conditionnement_config,
  '{priceLevel,billed_unit_id}',
  '"0acf2a5f-5ea4-48c5-8fee-e91a587eab53"'
)
WHERE id = '308fdf4c-bc65-4a71-879b-eb87da838803';

-- Product 2: GOBLET CARTON 20CL (Magnifiko) — c4905c17 (NONNA car) → ff3c8bb6 (Magnifiko car)
UPDATE products_v2
SET conditionnement_config = jsonb_set(
  conditionnement_config,
  '{priceLevel,billed_unit_id}',
  '"ff3c8bb6-7e0b-40ec-8880-5b74595d3d1c"'
)
WHERE id = '37a95f88-dbb3-474f-a1d7-3b30a063f427';

-- Product 3: COUVERT KIT 1/3 PLASTIQUE (Magnifiko) — c4905c17 (NONNA car) → ff3c8bb6 (Magnifiko car)
UPDATE products_v2
SET conditionnement_config = jsonb_set(
  conditionnement_config,
  '{priceLevel,billed_unit_id}',
  '"ff3c8bb6-7e0b-40ec-8880-5b74595d3d1c"'
)
WHERE id = 'ba9c16a6-7764-438f-9183-0601d1952cc8';

-- Product 4: Film alimentaire (Piccolo) — b6fc5c05 (NONNA col) → 99eed34d (Piccolo col)
UPDATE products_v2
SET conditionnement_config = jsonb_set(
  conditionnement_config,
  '{priceLevel,billed_unit_id}',
  '"99eed34d-a2ac-462d-b56d-c35812ae2294"'
)
WHERE id = '884bc029-c1b5-47f7-91fc-5312ccdfc03a';

-- Product 5: CÉLERI BRANCHE (Piccolo) — 252649a4 (NONNA pce) → 213208f9 (Piccolo pce)
UPDATE products_v2
SET conditionnement_config = jsonb_set(
  conditionnement_config,
  '{priceLevel,billed_unit_id}',
  '"213208f9-3696-4d0c-aafc-d6de618964ab"'
)
WHERE id = '910a6da7-155f-4dda-abe9-e961f8414ed4';
