
-- Phase 4: Health check function to detect cross-tenant UUID contamination
-- Returns rows where conditionnement_config references units not belonging to the product's establishment

CREATE OR REPLACE FUNCTION public.fn_health_check_cross_tenant_uuids(
  p_establishment_id uuid DEFAULT NULL
)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  establishment_id uuid,
  establishment_name text,
  foreign_uuid uuid,
  uuid_location text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH product_uuids AS (
    -- Extract all UUIDs from conditionnement_config JSON
    SELECT 
      p.id AS pid,
      p.nom_produit,
      p.establishment_id AS est_id,
      e.name AS est_name,
      -- Extract UUIDs from various JSON paths
      jsonb_path_query(p.conditionnement_config, '$.final_unit_id')::text AS uuid_val,
      'final_unit_id' AS loc
    FROM products_v2 p
    JOIN establishments e ON e.id = p.establishment_id
    WHERE p.conditionnement_config IS NOT NULL
      AND p.archived_at IS NULL
      AND (p_establishment_id IS NULL OR p.establishment_id = p_establishment_id)
      AND jsonb_typeof(p.conditionnement_config -> 'final_unit_id') = 'string'

    UNION ALL

    SELECT p.id, p.nom_produit, p.establishment_id, e.name,
      (lvl ->> 'type_unit_id'),
      'packagingLevels[].type_unit_id'
    FROM products_v2 p
    JOIN establishments e ON e.id = p.establishment_id,
    LATERAL jsonb_array_elements(p.conditionnement_config -> 'packagingLevels') AS lvl
    WHERE p.conditionnement_config IS NOT NULL
      AND p.archived_at IS NULL
      AND (p_establishment_id IS NULL OR p.establishment_id = p_establishment_id)
      AND jsonb_typeof(p.conditionnement_config -> 'packagingLevels') = 'array'
      AND lvl ->> 'type_unit_id' IS NOT NULL

    UNION ALL

    SELECT p.id, p.nom_produit, p.establishment_id, e.name,
      (lvl ->> 'contains_unit_id'),
      'packagingLevels[].contains_unit_id'
    FROM products_v2 p
    JOIN establishments e ON e.id = p.establishment_id,
    LATERAL jsonb_array_elements(p.conditionnement_config -> 'packagingLevels') AS lvl
    WHERE p.conditionnement_config IS NOT NULL
      AND p.archived_at IS NULL
      AND (p_establishment_id IS NULL OR p.establishment_id = p_establishment_id)
      AND jsonb_typeof(p.conditionnement_config -> 'packagingLevels') = 'array'
      AND lvl ->> 'contains_unit_id' IS NOT NULL

    UNION ALL

    SELECT p.id, p.nom_produit, p.establishment_id, e.name,
      (p.conditionnement_config -> 'equivalence' ->> 'source_unit_id'),
      'equivalence.source_unit_id'
    FROM products_v2 p
    JOIN establishments e ON e.id = p.establishment_id
    WHERE p.conditionnement_config IS NOT NULL
      AND p.archived_at IS NULL
      AND (p_establishment_id IS NULL OR p.establishment_id = p_establishment_id)
      AND p.conditionnement_config -> 'equivalence' ->> 'source_unit_id' IS NOT NULL

    UNION ALL

    SELECT p.id, p.nom_produit, p.establishment_id, e.name,
      (p.conditionnement_config -> 'equivalence' ->> 'unit_id'),
      'equivalence.unit_id'
    FROM products_v2 p
    JOIN establishments e ON e.id = p.establishment_id
    WHERE p.conditionnement_config IS NOT NULL
      AND p.archived_at IS NULL
      AND (p_establishment_id IS NULL OR p.establishment_id = p_establishment_id)
      AND p.conditionnement_config -> 'equivalence' ->> 'unit_id' IS NOT NULL

    UNION ALL

    SELECT p.id, p.nom_produit, p.establishment_id, e.name,
      (p.conditionnement_config -> 'priceLevel' ->> 'billed_unit_id'),
      'priceLevel.billed_unit_id'
    FROM products_v2 p
    JOIN establishments e ON e.id = p.establishment_id
    WHERE p.conditionnement_config IS NOT NULL
      AND p.archived_at IS NULL
      AND (p_establishment_id IS NULL OR p.establishment_id = p_establishment_id)
      AND p.conditionnement_config -> 'priceLevel' ->> 'billed_unit_id' IS NOT NULL
  )
  SELECT 
    pu.pid AS product_id,
    pu.nom_produit AS product_name,
    pu.est_id AS establishment_id,
    pu.est_name AS establishment_name,
    pu.uuid_val::uuid AS foreign_uuid,
    pu.loc AS uuid_location
  FROM product_uuids pu
  WHERE pu.uuid_val IS NOT NULL
    AND length(trim(both '"' from pu.uuid_val)) = 36
    AND NOT EXISTS (
      SELECT 1 FROM measurement_units mu
      WHERE mu.id = trim(both '"' from pu.uuid_val)::uuid
        AND mu.establishment_id = pu.est_id
    );
END;
$$;
