
-- Fix TEST6 priceLevel.levelId dangling reference
-- Replace source level ID (lvl_h931zi7) with correct client level ID (b2b-level-1775408526539-6)
UPDATE products_v2
SET conditionnement_config = jsonb_set(
  conditionnement_config,
  '{priceLevel,levelId}',
  '"b2b-level-1775408526539-6"'::jsonb
),
updated_at = now()
WHERE id = '575adb64-8e03-429f-8c70-6eb5aca400df'
  AND conditionnement_config->'priceLevel'->>'levelId' = 'lvl_h931zi7';
