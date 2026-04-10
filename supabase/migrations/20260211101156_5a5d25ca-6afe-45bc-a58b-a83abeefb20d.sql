
-- Migration 3.2: Backfill unit_ids in conditionnement_config JSONB
-- Non-destructive: adds *_unit_id fields alongside existing text fields
-- Rule: exact match only (name/abbreviation/aliases), ambiguous = null

-- Step 1: Add final_unit_id to configs
UPDATE products_v2 p
SET conditionnement_config = jsonb_set(
  p.conditionnement_config::jsonb,
  '{final_unit_id}',
  to_jsonb(mu.id)
)
FROM measurement_units mu
WHERE p.conditionnement_config IS NOT NULL
  AND p.establishment_id = mu.establishment_id
  AND mu.is_active = true
  AND (
    lower(mu.name) = lower(p.conditionnement_config::jsonb->>'finalUnit')
    OR lower(mu.abbreviation) = lower(p.conditionnement_config::jsonb->>'finalUnit')
  )
  AND p.conditionnement_config::jsonb->>'final_unit_id' IS NULL
  -- Anti-ambiguity: only if exactly 1 match
  AND (
    SELECT count(DISTINCT mu2.id) FROM measurement_units mu2
    WHERE mu2.establishment_id = p.establishment_id AND mu2.is_active = true
    AND (lower(mu2.name) = lower(p.conditionnement_config::jsonb->>'finalUnit')
         OR lower(mu2.abbreviation) = lower(p.conditionnement_config::jsonb->>'finalUnit'))
  ) = 1;
