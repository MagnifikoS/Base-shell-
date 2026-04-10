
-- Table for input configuration rules per product
CREATE TABLE public.product_input_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products_v2(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,

  -- Règle Réception fournisseur
  reception_mode TEXT NOT NULL DEFAULT 'integer',
  reception_default_unit_id UUID REFERENCES public.measurement_units(id),
  reception_level_1 BOOLEAN NOT NULL DEFAULT true,
  reception_level_2 BOOLEAN NOT NULL DEFAULT false,
  reception_final_unit BOOLEAN NOT NULL DEFAULT true,

  -- Règle Usage interne
  internal_mode TEXT NOT NULL DEFAULT 'integer',
  internal_default_unit_id UUID REFERENCES public.measurement_units(id),
  internal_level_1 BOOLEAN NOT NULL DEFAULT true,
  internal_level_2 BOOLEAN NOT NULL DEFAULT false,
  internal_final_unit BOOLEAN NOT NULL DEFAULT true,

  -- Métadonnées
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,

  UNIQUE(product_id, establishment_id)
);

-- RLS
ALTER TABLE public.product_input_config ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users can read configs for their establishment
CREATE POLICY "Users can read input config for their establishment"
  ON public.product_input_config
  FOR SELECT
  TO authenticated
  USING (
    establishment_id IN (
      SELECT e.id FROM public.establishments e
      JOIN public.profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

-- Policy: authenticated users can insert/update configs for their establishment
CREATE POLICY "Users can upsert input config for their establishment"
  ON public.product_input_config
  FOR INSERT
  TO authenticated
  WITH CHECK (
    establishment_id IN (
      SELECT e.id FROM public.establishments e
      JOIN public.profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update input config for their establishment"
  ON public.product_input_config
  FOR UPDATE
  TO authenticated
  USING (
    establishment_id IN (
      SELECT e.id FROM public.establishments e
      JOIN public.profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    establishment_id IN (
      SELECT e.id FROM public.establishments e
      JOIN public.profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete input config for their establishment"
  ON public.product_input_config
  FOR DELETE
  TO authenticated
  USING (
    establishment_id IN (
      SELECT e.id FROM public.establishments e
      JOIN public.profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

-- Index for fast lookups
CREATE INDEX idx_product_input_config_establishment ON public.product_input_config(establishment_id);
CREATE INDEX idx_product_input_config_product ON public.product_input_config(product_id);
