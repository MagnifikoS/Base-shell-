
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
    r.name           AS recipe_name,
    rt.name          AS recipe_type_name,
    rt.icon          AS recipe_type_icon,
    r.portions,
    rl.b2b_price,
    COALESCE(e.trade_name, e.name) AS supplier_name
  FROM b2b_followed_recipes fr
  JOIN b2b_recipe_listings rl ON rl.id = fr.listing_id
  JOIN recipes r              ON r.id = rl.recipe_id
  LEFT JOIN recipe_types rt   ON rt.id = r.recipe_type_id
  JOIN establishments e       ON e.id = rl.establishment_id
  WHERE fr.establishment_id = _establishment_id
    AND rl.is_published = true
  ORDER BY r.name;
$$;
