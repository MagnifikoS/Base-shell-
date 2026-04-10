
-- Add establishment_type to establishments
-- 'restaurant' (default) or 'fournisseur'
ALTER TABLE public.establishments
  ADD COLUMN establishment_type text NOT NULL DEFAULT 'restaurant'
  CONSTRAINT establishments_type_check CHECK (establishment_type IN ('restaurant', 'fournisseur'));

-- Index for quick filtering by type
CREATE INDEX idx_establishments_type ON public.establishments (establishment_type);
