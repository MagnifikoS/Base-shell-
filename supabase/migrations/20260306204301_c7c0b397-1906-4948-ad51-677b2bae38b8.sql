
-- ═══════════════════════════════════════════════════════════════
-- Étape 1a : Table inventory_articles (V0 — PAS de min_stock)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE public.inventory_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  storage_zone_id UUID REFERENCES public.storage_zones(id),
  canonical_unit_id UUID NOT NULL REFERENCES public.measurement_units(id),
  canonical_family TEXT NOT NULL,
  threshold_product_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════
-- Étape 1b : RLS
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.inventory_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view inventory articles of their establishment"
  ON public.inventory_articles FOR SELECT TO authenticated
  USING (
    establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert inventory articles in their establishment"
  ON public.inventory_articles FOR INSERT TO authenticated
  WITH CHECK (
    establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update inventory articles in their establishment"
  ON public.inventory_articles FOR UPDATE TO authenticated
  USING (
    establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete inventory articles in their establishment"
  ON public.inventory_articles FOR DELETE TO authenticated
  USING (
    establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- Étape 1c : FK inventory_article_id sur products_v2
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.products_v2
  ADD COLUMN IF NOT EXISTS inventory_article_id UUID
  REFERENCES public.inventory_articles(id);

-- ═══════════════════════════════════════════════════════════════
-- Étape 1d : FK circulaire threshold_product_id → products_v2
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.inventory_articles
  ADD CONSTRAINT fk_threshold_product
  FOREIGN KEY (threshold_product_id) REFERENCES public.products_v2(id);

-- ═══════════════════════════════════════════════════════════════
-- Étape 1e : Index
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX idx_inv_articles_establishment ON public.inventory_articles(establishment_id) WHERE archived_at IS NULL;
CREATE INDEX idx_inv_articles_zone ON public.inventory_articles(storage_zone_id) WHERE archived_at IS NULL;
CREATE INDEX idx_inv_articles_name_norm ON public.inventory_articles(establishment_id, name_normalized);
CREATE INDEX idx_products_v2_inv_article ON public.products_v2(inventory_article_id) WHERE archived_at IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- Étape 1f : Trigger — valider threshold_product_id
-- (même établissement, lié à cet article, même famille canonique)
-- Note: products_v2 n'a pas canonical_family directement,
-- on résout via stock_handling_unit_id → measurement_units.family
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_validate_threshold_product()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_est_id UUID;
  v_article_id UUID;
  v_product_family TEXT;
BEGIN
  IF NEW.threshold_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Charger le produit porteur candidat
  SELECT p.establishment_id, p.inventory_article_id, COALESCE(u.family, 'unit')
  INTO v_est_id, v_article_id, v_product_family
  FROM products_v2 p
  LEFT JOIN measurement_units u ON u.id = p.stock_handling_unit_id
  WHERE p.id = NEW.threshold_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'threshold_product_id % does not exist', NEW.threshold_product_id;
  END IF;

  -- Contrainte 1 : même établissement
  IF v_est_id != NEW.establishment_id THEN
    RAISE EXCEPTION 'threshold_product_id must belong to same establishment as article';
  END IF;

  -- Contrainte 2 : lié à cet article
  IF v_article_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'threshold_product_id must be linked to this article (inventory_article_id = article.id)';
  END IF;

  -- Contrainte 3 : même famille canonique
  IF v_product_family != NEW.canonical_family THEN
    RAISE EXCEPTION 'threshold_product_id must have same canonical_family as article';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_threshold_product
  BEFORE INSERT OR UPDATE OF threshold_product_id ON public.inventory_articles
  FOR EACH ROW
  EXECUTE FUNCTION fn_validate_threshold_product();

-- ═══════════════════════════════════════════════════════════════
-- Étape 1g : Trigger — nettoyer threshold si produit détaché
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_clear_threshold_on_unlink()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.inventory_article_id IS NOT NULL
     AND (NEW.inventory_article_id IS NULL OR NEW.inventory_article_id != OLD.inventory_article_id) THEN
    UPDATE inventory_articles
    SET threshold_product_id = NULL, updated_at = now()
    WHERE id = OLD.inventory_article_id
      AND threshold_product_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clear_threshold_on_unlink
  BEFORE UPDATE OF inventory_article_id ON public.products_v2
  FOR EACH ROW
  EXECUTE FUNCTION fn_clear_threshold_on_unlink();

-- ═══════════════════════════════════════════════════════════════
-- Étape 1h : Auto-migration 1:1 — produits existants → articles
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.inventory_articles (establishment_id, name, name_normalized, storage_zone_id, canonical_unit_id, canonical_family)
SELECT
  p.establishment_id,
  p.nom_produit,
  lower(trim(p.nom_produit)),
  p.storage_zone_id,
  p.stock_handling_unit_id,
  COALESCE(u.family, 'unit')
FROM public.products_v2 p
LEFT JOIN public.measurement_units u ON u.id = p.stock_handling_unit_id
WHERE p.archived_at IS NULL
  AND p.stock_handling_unit_id IS NOT NULL;

-- Link back products to their newly created articles
UPDATE public.products_v2 p
SET inventory_article_id = ia.id
FROM public.inventory_articles ia
WHERE ia.establishment_id = p.establishment_id
  AND ia.name = p.nom_produit
  AND ia.canonical_unit_id = p.stock_handling_unit_id
  AND p.archived_at IS NULL
  AND p.inventory_article_id IS NULL
  AND p.stock_handling_unit_id IS NOT NULL;
