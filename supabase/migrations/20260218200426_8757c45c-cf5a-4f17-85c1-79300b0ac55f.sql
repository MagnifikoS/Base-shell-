
-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Patch bl_app_lines avec les prix manquants depuis products_v2
-- Root cause: les lignes ont été créées avec unit_price=NULL et line_total=NULL
-- car les prix n'étaient pas encore renseignés au moment de la création des BL
-- OU parce que le upsert a réécrit NULL par-dessus des valeurs valides.
--
-- Règle SSOT: on patche uniquement les lignes où unit_price IS NULL
-- et où final_unit_id correspond à canonical_unit_id (calcul direct sans BFS).
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE bl_app_lines bal
SET
  unit_price  = p.final_unit_price,
  line_total  = ROUND((bal.quantity_canonical * p.final_unit_price)::numeric, 2)
FROM products_v2 p
WHERE bal.product_id       = p.id
  AND bal.unit_price       IS NULL            -- only patch missing prices
  AND p.final_unit_price   IS NOT NULL        -- only when price exists in SSOT
  AND p.final_unit_id      IS NOT NULL        -- only when unit is defined
  AND p.final_unit_id      = bal.canonical_unit_id;  -- only when units match (direct multiply, no BFS needed)
