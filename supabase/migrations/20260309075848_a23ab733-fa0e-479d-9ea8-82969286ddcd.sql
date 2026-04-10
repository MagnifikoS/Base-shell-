
-- ============================================================
-- B2B Recipe Catalogue V1 — Tables + RLS
-- Domaine strictement isolé du catalogue produit B2B
-- Aucune table existante n'est modifiée
-- ============================================================

-- 1. b2b_recipe_listings (côté fournisseur)
-- Entité commerciale dédiée : une recette publiée pour les partenaires B2B
CREATE TABLE public.b2b_recipe_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  is_published BOOLEAN NOT NULL DEFAULT false,
  b2b_price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_b2b_recipe_listing UNIQUE (establishment_id, recipe_id)
);

CREATE INDEX idx_b2b_recipe_listings_est ON public.b2b_recipe_listings(establishment_id);
CREATE INDEX idx_b2b_recipe_listings_recipe ON public.b2b_recipe_listings(recipe_id);
CREATE INDEX idx_b2b_recipe_listings_published ON public.b2b_recipe_listings(establishment_id, is_published) WHERE is_published = true;

-- 2. b2b_followed_recipes (côté client)
-- Le client "suit" un listing recette fournisseur (pas de copie fonctionnelle)
CREATE TABLE public.b2b_followed_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  listing_id UUID NOT NULL REFERENCES public.b2b_recipe_listings(id) ON DELETE CASCADE,
  partnership_id UUID NOT NULL REFERENCES public.b2b_partnerships(id),
  followed_by UUID,
  followed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_b2b_followed_recipe UNIQUE (establishment_id, listing_id)
);

CREATE INDEX idx_b2b_followed_recipes_est ON public.b2b_followed_recipes(establishment_id);
CREATE INDEX idx_b2b_followed_recipes_listing ON public.b2b_followed_recipes(listing_id);

-- 3. Trigger updated_at pour b2b_recipe_listings
CREATE OR REPLACE FUNCTION public.fn_b2b_recipe_listings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_b2b_recipe_listings_updated_at
  BEFORE UPDATE ON public.b2b_recipe_listings
  FOR EACH ROW EXECUTE FUNCTION public.fn_b2b_recipe_listings_updated_at();

-- 4. RLS — b2b_recipe_listings
ALTER TABLE public.b2b_recipe_listings ENABLE ROW LEVEL SECURITY;

-- Fournisseur : lecture de ses propres listings
CREATE POLICY "b2b_recipe_listings_select_owner"
  ON public.b2b_recipe_listings FOR SELECT TO authenticated
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- Partenaires clients : lecture des listings publiés de leurs fournisseurs
CREATE POLICY "b2b_recipe_listings_select_partner"
  ON public.b2b_recipe_listings FOR SELECT TO authenticated
  USING (
    is_published = true
    AND EXISTS (
      SELECT 1 FROM public.b2b_partnerships bp
      WHERE bp.supplier_establishment_id = b2b_recipe_listings.establishment_id
        AND bp.client_establishment_id IN (SELECT public.get_user_establishment_ids())
        AND bp.status = 'active'
    )
  );

-- Fournisseur : insertion de ses propres listings
CREATE POLICY "b2b_recipe_listings_insert"
  ON public.b2b_recipe_listings FOR INSERT TO authenticated
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- Fournisseur : mise à jour de ses propres listings
CREATE POLICY "b2b_recipe_listings_update"
  ON public.b2b_recipe_listings FOR UPDATE TO authenticated
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()))
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- Fournisseur : suppression de ses propres listings
CREATE POLICY "b2b_recipe_listings_delete"
  ON public.b2b_recipe_listings FOR DELETE TO authenticated
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- 5. RLS — b2b_followed_recipes
ALTER TABLE public.b2b_followed_recipes ENABLE ROW LEVEL SECURITY;

-- Client : lecture de ses propres suivis
CREATE POLICY "b2b_followed_recipes_select"
  ON public.b2b_followed_recipes FOR SELECT TO authenticated
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- Client : ajout de suivis
CREATE POLICY "b2b_followed_recipes_insert"
  ON public.b2b_followed_recipes FOR INSERT TO authenticated
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- Client : suppression de suivis
CREATE POLICY "b2b_followed_recipes_delete"
  ON public.b2b_followed_recipes FOR DELETE TO authenticated
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- 6. RPC sécurisée pour le catalogue recettes B2B
-- Retourne uniquement les données commerciales, JAMAIS les ingrédients
CREATE OR REPLACE FUNCTION public.fn_get_b2b_recipe_catalogue(
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
  selling_price_mode TEXT,
  is_followed BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rl.id AS listing_id,
    r.id AS recipe_id,
    r.name AS recipe_name,
    rt.name AS recipe_type_name,
    rt.icon AS recipe_type_icon,
    r.portions,
    rl.b2b_price,
    r.selling_price_mode::TEXT,
    EXISTS (
      SELECT 1 FROM public.b2b_followed_recipes fr
      WHERE fr.listing_id = rl.id
        AND fr.establishment_id IN (SELECT public.get_user_establishment_ids())
    ) AS is_followed
  FROM public.b2b_recipe_listings rl
  JOIN public.recipes r ON r.id = rl.recipe_id
  LEFT JOIN public.recipe_types rt ON rt.id = r.recipe_type_id
  WHERE rl.establishment_id = _supplier_establishment_id
    AND rl.is_published = true
    AND EXISTS (
      SELECT 1 FROM public.b2b_partnerships bp
      WHERE bp.supplier_establishment_id = _supplier_establishment_id
        AND bp.client_establishment_id IN (SELECT public.get_user_establishment_ids())
        AND bp.status = 'active'
    );
$$;
