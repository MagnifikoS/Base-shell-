
-- ═══════════════════════════════════════════════════════════════
-- ÉTAPE 3 — Migration: family + is_reference sur measurement_units
--                       + nouvelle table unit_conversions
-- ═══════════════════════════════════════════════════════════════

-- 1) Ajouter colonnes family et is_reference à measurement_units
ALTER TABLE public.measurement_units
  ADD COLUMN IF NOT EXISTS family TEXT,
  ADD COLUMN IF NOT EXISTS is_reference BOOLEAN NOT NULL DEFAULT false;

-- 2) Peupler family pour les unités existantes
UPDATE public.measurement_units SET family = 'weight' WHERE abbreviation IN ('kg', 'g');
UPDATE public.measurement_units SET family = 'volume' WHERE abbreviation IN ('L', 'ml', 'cl');
UPDATE public.measurement_units SET family = 'count' WHERE abbreviation IN ('pce', 'u', 'port');
-- packaging n'a pas de family (ce ne sont pas des unités de mesure)
UPDATE public.measurement_units SET family = NULL WHERE category = 'packaging';

-- 3) Marquer les unités de référence (canoniques par famille)
UPDATE public.measurement_units SET is_reference = true WHERE abbreviation = 'kg';
UPDATE public.measurement_units SET is_reference = true WHERE abbreviation = 'L';
UPDATE public.measurement_units SET is_reference = true WHERE abbreviation = 'pce';

-- 4) Créer la table unit_conversions
CREATE TABLE IF NOT EXISTS public.unit_conversions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_unit_id UUID NOT NULL REFERENCES public.measurement_units(id) ON DELETE CASCADE,
  to_unit_id UUID NOT NULL REFERENCES public.measurement_units(id) ON DELETE CASCADE,
  factor NUMERIC NOT NULL,
  establishment_id UUID REFERENCES public.establishments(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(from_unit_id, to_unit_id, establishment_id)
);

-- 5) RLS
ALTER TABLE public.unit_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view unit conversions for their establishment"
  ON public.unit_conversions FOR SELECT
  USING (
    establishment_id IS NULL
    OR establishment_id IN (
      SELECT e.id FROM establishments e
      INNER JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage unit conversions for their establishment"
  ON public.unit_conversions FOR ALL
  USING (
    establishment_id IN (
      SELECT e.id FROM establishments e
      INNER JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

-- 6) Index pour performance
CREATE INDEX IF NOT EXISTS idx_unit_conversions_from ON public.unit_conversions(from_unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_conversions_to ON public.unit_conversions(to_unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_conversions_establishment ON public.unit_conversions(establishment_id);
CREATE INDEX IF NOT EXISTS idx_measurement_units_family ON public.measurement_units(family);

-- 7) Seed conversions universelles (par establishment)
-- On insère les conversions pour chaque establishment qui a des unités
-- g → kg
INSERT INTO public.unit_conversions (from_unit_id, to_unit_id, factor, establishment_id)
SELECT g.id, kg.id, 0.001, g.establishment_id
FROM measurement_units g
JOIN measurement_units kg ON kg.abbreviation = 'kg' AND kg.establishment_id = g.establishment_id
WHERE g.abbreviation = 'g'
ON CONFLICT DO NOTHING;

-- kg → g
INSERT INTO public.unit_conversions (from_unit_id, to_unit_id, factor, establishment_id)
SELECT kg.id, g.id, 1000, kg.establishment_id
FROM measurement_units kg
JOIN measurement_units g ON g.abbreviation = 'g' AND g.establishment_id = kg.establishment_id
WHERE kg.abbreviation = 'kg'
ON CONFLICT DO NOTHING;

-- ml → L
INSERT INTO public.unit_conversions (from_unit_id, to_unit_id, factor, establishment_id)
SELECT ml.id, l.id, 0.001, ml.establishment_id
FROM measurement_units ml
JOIN measurement_units l ON l.abbreviation = 'L' AND l.establishment_id = ml.establishment_id
WHERE ml.abbreviation = 'ml'
ON CONFLICT DO NOTHING;

-- L → ml
INSERT INTO public.unit_conversions (from_unit_id, to_unit_id, factor, establishment_id)
SELECT l.id, ml.id, 1000, l.establishment_id
FROM measurement_units l
JOIN measurement_units ml ON ml.abbreviation = 'ml' AND ml.establishment_id = l.establishment_id
WHERE l.abbreviation = 'L'
ON CONFLICT DO NOTHING;

-- cl → L
INSERT INTO public.unit_conversions (from_unit_id, to_unit_id, factor, establishment_id)
SELECT cl.id, l.id, 0.01, cl.establishment_id
FROM measurement_units cl
JOIN measurement_units l ON l.abbreviation = 'L' AND l.establishment_id = cl.establishment_id
WHERE cl.abbreviation = 'cl'
ON CONFLICT DO NOTHING;

-- L → cl
INSERT INTO public.unit_conversions (from_unit_id, to_unit_id, factor, establishment_id)
SELECT l.id, cl.id, 100, l.establishment_id
FROM measurement_units l
JOIN measurement_units cl ON cl.abbreviation = 'cl' AND cl.establishment_id = l.establishment_id
WHERE l.abbreviation = 'L'
ON CONFLICT DO NOTHING;

-- cl → ml
INSERT INTO public.unit_conversions (from_unit_id, to_unit_id, factor, establishment_id)
SELECT cl.id, ml.id, 10, cl.establishment_id
FROM measurement_units cl
JOIN measurement_units ml ON ml.abbreviation = 'ml' AND ml.establishment_id = cl.establishment_id
WHERE cl.abbreviation = 'cl'
ON CONFLICT DO NOTHING;

-- ml → cl
INSERT INTO public.unit_conversions (from_unit_id, to_unit_id, factor, establishment_id)
SELECT ml.id, cl.id, 0.1, ml.establishment_id
FROM measurement_units ml
JOIN measurement_units cl ON cl.abbreviation = 'cl' AND cl.establishment_id = ml.establishment_id
WHERE ml.abbreviation = 'ml'
ON CONFLICT DO NOTHING;

-- g → g (identity, useful for lookups)
-- Not needed since same unit = factor 1 by convention
