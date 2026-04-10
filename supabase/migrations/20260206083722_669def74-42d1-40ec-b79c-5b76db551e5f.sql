-- Table des paramètres d'extraction Vision AI par établissement
CREATE TABLE public.extraction_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  
  -- 1. Détection facture déjà importée (toujours active, non désactivable)
  -- Géré en dur dans le code, pas de paramètre ici
  
  -- 2. Filtrage produits déjà existants
  filter_existing_products BOOLEAN NOT NULL DEFAULT true,
  show_existing_products_debug BOOLEAN NOT NULL DEFAULT false,
  
  -- 3. Variation de prix
  price_variation_enabled BOOLEAN NOT NULL DEFAULT true,
  price_variation_tolerance_pct NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  price_variation_blocking BOOLEAN NOT NULL DEFAULT false,
  
  -- 4. Quantité anormale
  abnormal_quantity_enabled BOOLEAN NOT NULL DEFAULT true,
  abnormal_quantity_tolerance_pct NUMERIC(5,2) NOT NULL DEFAULT 30.00,
  abnormal_quantity_blocking BOOLEAN NOT NULL DEFAULT false,
  
  -- 5. Produits rarement achetés
  rarely_bought_enabled BOOLEAN NOT NULL DEFAULT true,
  rarely_bought_threshold_count INTEGER NOT NULL DEFAULT 2,
  rarely_bought_period_months INTEGER NOT NULL DEFAULT 3,
  
  -- 6. Prix manquant
  missing_price_enabled BOOLEAN NOT NULL DEFAULT true,
  missing_price_blocking BOOLEAN NOT NULL DEFAULT true,
  
  -- 7. Facture atypique (info only)
  atypical_invoice_enabled BOOLEAN NOT NULL DEFAULT true,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT extraction_settings_establishment_unique UNIQUE (establishment_id)
);

-- Enable RLS
ALTER TABLE public.extraction_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view extraction settings for their establishments"
  ON public.extraction_settings FOR SELECT
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "Users can insert extraction settings for their establishments"
  ON public.extraction_settings FOR INSERT
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "Users can update extraction settings for their establishments"
  ON public.extraction_settings FOR UPDATE
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- Auto-update timestamp trigger
CREATE TRIGGER update_extraction_settings_updated_at
  BEFORE UPDATE ON public.extraction_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for fast lookups
CREATE INDEX idx_extraction_settings_establishment ON public.extraction_settings(establishment_id);