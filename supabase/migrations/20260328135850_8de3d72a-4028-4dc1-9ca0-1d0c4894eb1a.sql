
-- ═══════════════════════════════════════════════════════════════════════
-- fn_get_group_members — Helper central de mutualisation B2B
-- 
-- Résout le groupe mutualisé d'un produit donné.
-- Si le produit n'est dans aucun groupe, retourne un "groupe virtuel de 1"
-- (le produit est son propre carrier et seul membre).
--
-- Réutilisable par : catalogue B2B, import, expédition, stock agrégé.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_get_group_members(
  p_product_id uuid,
  p_establishment_id uuid
)
RETURNS TABLE (
  group_id uuid,
  group_display_name text,
  carrier_product_id uuid,
  member_product_id uuid,
  is_carrier boolean,
  is_mutualized boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Cas 1 : le produit est dans un groupe actif (via membership)
  -- Retourne TOUS les membres du groupe
  SELECT
    img.id AS group_id,
    img.display_name AS group_display_name,
    img.carrier_product_id,
    imm2.product_id AS member_product_id,
    (imm2.product_id = img.carrier_product_id) AS is_carrier,
    true AS is_mutualized
  FROM inventory_mutualisation_members imm
  JOIN inventory_mutualisation_groups img
    ON img.id = imm.group_id
    AND img.establishment_id = p_establishment_id
    AND img.is_active = true
  JOIN inventory_mutualisation_members imm2
    ON imm2.group_id = img.id
  WHERE imm.product_id = p_product_id

  UNION ALL

  -- Cas 2 : le produit n'est dans aucun groupe actif → groupe virtuel de 1
  SELECT
    NULL::uuid AS group_id,
    NULL::text AS group_display_name,
    p_product_id AS carrier_product_id,
    p_product_id AS member_product_id,
    true AS is_carrier,
    false AS is_mutualized
  WHERE NOT EXISTS (
    SELECT 1
    FROM inventory_mutualisation_members imm
    JOIN inventory_mutualisation_groups img
      ON img.id = imm.group_id
      AND img.establishment_id = p_establishment_id
      AND img.is_active = true
    WHERE imm.product_id = p_product_id
  )
$$;

COMMENT ON FUNCTION fn_get_group_members(uuid, uuid) IS
'Helper central de mutualisation. Résout le groupe complet d''un produit (carrier + membres). '
'Si le produit n''est dans aucun groupe actif, retourne un groupe virtuel de 1 (lui-même = carrier = seul membre). '
'Utilisé par : catalogue B2B, import, expédition, stock agrégé.';
