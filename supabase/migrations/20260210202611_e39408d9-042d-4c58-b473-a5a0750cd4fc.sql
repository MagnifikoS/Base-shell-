
-- ═══════════════════════════════════════════════════════════════════════════
-- STORAGE ZONES — Table SSOT pour les zones de stockage par établissement
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.storage_zones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Unicité par établissement
  CONSTRAINT uq_storage_zones_establishment_name UNIQUE (establishment_id, name_normalized)
);

-- Index
CREATE INDEX idx_storage_zones_establishment ON public.storage_zones(establishment_id);

-- RLS
ALTER TABLE public.storage_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view storage zones of their establishment"
  ON public.storage_zones FOR SELECT
  USING (
    establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert storage zones"
  ON public.storage_zones FOR INSERT
  WITH CHECK (
    establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update storage zones"
  ON public.storage_zones FOR UPDATE
  USING (
    establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete storage zones"
  ON public.storage_zones FOR DELETE
  USING (
    establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- ADD storage_zone_id FK to products_v2
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.products_v2 
  ADD COLUMN storage_zone_id UUID REFERENCES public.storage_zones(id) ON DELETE SET NULL;

CREATE INDEX idx_products_v2_storage_zone ON public.products_v2(storage_zone_id);

-- Trigger updated_at
CREATE TRIGGER update_storage_zones_updated_at
  BEFORE UPDATE ON public.storage_zones
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
