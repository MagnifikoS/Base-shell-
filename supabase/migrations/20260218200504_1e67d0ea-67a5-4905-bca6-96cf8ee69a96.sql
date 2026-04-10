
-- Pour les lignes où final_unit_id ≠ canonical_unit_id (unités différentes),
-- on snapshotte quand même le prix unitaire (référence) même si le total n'est pas calculable.
-- Cela permet d'afficher "1.60 €/pce" dans la colonne Prix unit. au lieu de "—"

UPDATE bl_app_lines bal
SET unit_price = p.final_unit_price
FROM products_v2 p
WHERE bal.product_id     = p.id
  AND bal.unit_price     IS NULL
  AND p.final_unit_price IS NOT NULL;
-- line_total reste NULL (légitimement non calculable sans BFS)
