
-- ============================================================
-- Étape 1 : Enrichir b2b_recipe_listings en fiche plat commerciale
-- Ajout de commercial_name, portions, recipe_type_id
-- Backfill depuis recipes pour les listings existants
-- Aucune autre table n'est touchée
-- ============================================================

-- 1. Ajout des colonnes commerciales
ALTER TABLE public.b2b_recipe_listings
  ADD COLUMN IF NOT EXISTS commercial_name TEXT,
  ADD COLUMN IF NOT EXISTS portions INTEGER,
  ADD COLUMN IF NOT EXISTS recipe_type_id UUID REFERENCES public.recipe_types(id);

-- 2. Backfill : initialiser depuis la recette source pour les listings existants
UPDATE public.b2b_recipe_listings rl
SET
  commercial_name = r.name,
  portions = r.portions,
  recipe_type_id = r.recipe_type_id
FROM public.recipes r
WHERE rl.recipe_id = r.id
  AND rl.commercial_name IS NULL;

-- 3. Contrainte : commercial_name obligatoire pour les futurs inserts
-- On met NOT NULL avec un default temporaire pour ne pas casser les existants
-- Puis on force la valeur via trigger
ALTER TABLE public.b2b_recipe_listings
  ALTER COLUMN commercial_name SET NOT NULL,
  ALTER COLUMN commercial_name SET DEFAULT '';

-- 4. Contrainte : portions >= 1 si renseigné (cohérent avec recipes)
ALTER TABLE public.b2b_recipe_listings
  ADD CONSTRAINT chk_b2b_listing_portions CHECK (portions IS NULL OR portions >= 1);

-- 5. Index sur recipe_type_id pour jointures futures
CREATE INDEX IF NOT EXISTS idx_b2b_recipe_listings_type ON public.b2b_recipe_listings(recipe_type_id);

-- 6. Trigger : auto-remplir commercial_name depuis recipe si vide à l'insertion
CREATE OR REPLACE FUNCTION public.fn_b2b_listing_default_commercial_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Si commercial_name vide, copier depuis la recette source
  IF NEW.commercial_name IS NULL OR NEW.commercial_name = '' THEN
    SELECT r.name INTO NEW.commercial_name
    FROM public.recipes r
    WHERE r.id = NEW.recipe_id;
  END IF;
  -- Si portions pas renseigné, copier depuis la recette source
  IF NEW.portions IS NULL THEN
    SELECT r.portions INTO NEW.portions
    FROM public.recipes r
    WHERE r.id = NEW.recipe_id;
  END IF;
  -- Si recipe_type_id pas renseigné, copier depuis la recette source
  IF NEW.recipe_type_id IS NULL THEN
    SELECT r.recipe_type_id INTO NEW.recipe_type_id
    FROM public.recipes r
    WHERE r.id = NEW.recipe_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_b2b_listing_default_fields
  BEFORE INSERT ON public.b2b_recipe_listings
  FOR EACH ROW EXECUTE FUNCTION public.fn_b2b_listing_default_commercial_name();
