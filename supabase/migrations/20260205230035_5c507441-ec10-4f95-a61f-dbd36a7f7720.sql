-- ============================================================
-- Vision AI Module - Tables indépendantes
-- ============================================================

-- Table des unités de mesure
CREATE TABLE public.measurement_units (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  abbreviation TEXT NOT NULL,
  aliases TEXT[] DEFAULT '{}',
  category TEXT NOT NULL DEFAULT 'base' CHECK (category IN ('base', 'packaging', 'cuisine')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(establishment_id, abbreviation)
);

-- Table des formats de conditionnement
CREATE TABLE public.packaging_formats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  unit_id UUID NOT NULL REFERENCES public.measurement_units(id) ON DELETE RESTRICT,
  quantity NUMERIC(10, 4) NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.measurement_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packaging_formats ENABLE ROW LEVEL SECURITY;

-- RLS Policies for measurement_units
CREATE POLICY "Users can view measurement units of their organization"
ON public.measurement_units FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert measurement units in their organization"
ON public.measurement_units FOR INSERT
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can update measurement units in their organization"
ON public.measurement_units FOR UPDATE
USING (
  organization_id IN (
    SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete custom measurement units in their organization"
ON public.measurement_units FOR DELETE
USING (
  organization_id IN (
    SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
  )
  AND is_system = false
);

-- RLS Policies for packaging_formats
CREATE POLICY "Users can view packaging formats of their organization"
ON public.packaging_formats FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert packaging formats in their organization"
ON public.packaging_formats FOR INSERT
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can update packaging formats in their organization"
ON public.packaging_formats FOR UPDATE
USING (
  organization_id IN (
    SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete packaging formats in their organization"
ON public.packaging_formats FOR DELETE
USING (
  organization_id IN (
    SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
  )
);

-- Trigger for updated_at
CREATE TRIGGER update_measurement_units_updated_at
BEFORE UPDATE ON public.measurement_units
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_packaging_formats_updated_at
BEFORE UPDATE ON public.packaging_formats
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_measurement_units_establishment ON public.measurement_units(establishment_id);
CREATE INDEX idx_measurement_units_active ON public.measurement_units(establishment_id, is_active);
CREATE INDEX idx_packaging_formats_establishment ON public.packaging_formats(establishment_id);
CREATE INDEX idx_packaging_formats_unit ON public.packaging_formats(unit_id);