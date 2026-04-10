
-- Étape 3: Drop + recreate RPCs to read from commercial sheet
-- selling_price_mode is internal data — removed from catalogue RPC

DROP FUNCTION IF EXISTS public.fn_get_b2b_recipe_catalogue(uuid);

CREATE FUNCTION public.fn_get_b2b_recipe_catalogue(
  _supplier_establishment_id UUID
)
RETURNS TABLE (
  listing_id UUID,
  recipe_id UUID,
  recipe_name TEXT,
  recipe_type_name TEXT,
  recipe_type_icon TEXT,
  portions INTEGER,
  b2b_price NUMERIC,
  is_followed BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rl.id AS listing_id,
    rl.recipe_id,
    rl.commercial_name AS recipe_name,
    rt.name AS recipe_type_name,
    rt.icon AS recipe_type_icon,
    rl.portions,
    rl.b2b_price,
    EXISTS (
      SELECT 1 FROM public.b2b_followed_recipes fr
      WHERE fr.listing_id = rl.id
        AND fr.establishment_id IN (SELECT public.get_user_establishment_ids())
    ) AS is_followed
  FROM public.b2b_recipe_listings rl
  LEFT JOIN public.recipe_types rt ON rt.id = rl.recipe_type_id
  WHERE rl.establishment_id = _supplier_establishment_id
    AND rl.is_published = true
    AND EXISTS (
      SELECT 1 FROM public.b2b_partnerships bp
      WHERE bp.supplier_establishment_id = _supplier_establishment_id
        AND bp.client_establishment_id IN (SELECT public.get_user_establishment_ids())
        AND bp.status = 'active'
    );
$$;

-- fn_get_b2b_followed_recipes — same return type, just update body
CREATE OR REPLACE FUNCTION public.fn_get_b2b_followed_recipes(_establishment_id uuid)
RETURNS TABLE (
  id uuid,
  listing_id uuid,
  partnership_id uuid,
  followed_at timestamptz,
  recipe_name text,
  recipe_type_name text,
  recipe_type_icon text,
  portions integer,
  b2b_price numeric,
  supplier_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fr.id,
    fr.listing_id,
    fr.partnership_id,
    fr.followed_at,
    rl.commercial_name AS recipe_name,
    rt.name            AS recipe_type_name,
    rt.icon            AS recipe_type_icon,
    rl.portions,
    rl.b2b_price,
    COALESCE(e.trade_name, e.name) AS supplier_name
  FROM b2b_followed_recipes fr
  JOIN b2b_recipe_listings rl ON rl.id = fr.listing_id
  LEFT JOIN recipe_types rt   ON rt.id = rl.recipe_type_id
  JOIN establishments e       ON e.id = rl.establishment_id
  WHERE fr.establishment_id = _establishment_id
    AND rl.is_published = true
  ORDER BY rl.commercial_name;
$$;
