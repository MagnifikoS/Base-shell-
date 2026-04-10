
-- Function to extract packaging signature from a product's conditionnement_config
-- Used by mutualisation module to compare real packaging across products
-- Returns the first (outermost) packaging level's identity
CREATE OR REPLACE FUNCTION public.fn_get_packaging_signature(p_product_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN cc IS NOT NULL
           AND jsonb_array_length(cc -> 'packagingLevels') > 0
      THEN jsonb_build_object(
        'packaging_type_unit_id', (cc -> 'packagingLevels' -> 0 ->> 'type_unit_id'),
        'contains_quantity',      (cc -> 'packagingLevels' -> 0 ->> 'containsQuantity')::numeric,
        'contains_unit_id',       (cc -> 'packagingLevels' -> 0 ->> 'contains_unit_id')
      )
      ELSE NULL
    END
  FROM (
    SELECT conditionnement_config AS cc
    FROM products_v2
    WHERE id = p_product_id
      AND archived_at IS NULL
  ) sub
$$;

-- Allow authenticated users to call this function
GRANT EXECUTE ON FUNCTION public.fn_get_packaging_signature(UUID) TO authenticated;
