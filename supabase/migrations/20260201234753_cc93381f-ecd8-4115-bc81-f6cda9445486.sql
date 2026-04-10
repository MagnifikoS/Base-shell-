-- Table: supplier_extraction_profiles
-- Stores extraction configuration per supplier for precise data mapping

CREATE TABLE public.supplier_extraction_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id UUID NOT NULL REFERENCES public.invoice_suppliers(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Schema versioning
  schema_version INTEGER NOT NULL DEFAULT 1,
  
  -- JSON profile configuration (fields mapping, normalization rules, etc.)
  profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Lifecycle tracking
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated')),
  created_from_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  validated_by UUID,
  validated_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- One profile per supplier per establishment
  CONSTRAINT supplier_extraction_profiles_unique UNIQUE (supplier_id, establishment_id)
);

-- Add index for fast lookups
CREATE INDEX idx_supplier_extraction_profiles_supplier ON public.supplier_extraction_profiles(supplier_id, establishment_id);

-- Enable RLS
ALTER TABLE public.supplier_extraction_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies (factures module scoped)
CREATE POLICY "supplier_extraction_profiles_select"
  ON public.supplier_extraction_profiles
  FOR SELECT
  USING (has_module_access('factures'::text, 'read'::access_level, establishment_id));

CREATE POLICY "supplier_extraction_profiles_insert"
  ON public.supplier_extraction_profiles
  FOR INSERT
  WITH CHECK (has_module_access('factures'::text, 'write'::access_level, establishment_id));

CREATE POLICY "supplier_extraction_profiles_update"
  ON public.supplier_extraction_profiles
  FOR UPDATE
  USING (has_module_access('factures'::text, 'write'::access_level, establishment_id));

CREATE POLICY "supplier_extraction_profiles_delete"
  ON public.supplier_extraction_profiles
  FOR DELETE
  USING (has_module_access('factures'::text, 'write'::access_level, establishment_id));

-- Updated_at trigger
CREATE TRIGGER update_supplier_extraction_profiles_updated_at
  BEFORE UPDATE ON public.supplier_extraction_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();