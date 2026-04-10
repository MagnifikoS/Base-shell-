-- ============================================================
-- Table: invoice_extractions
-- Universal extraction storage per invoice (SSOT)
-- Module owner: factures
-- ============================================================

CREATE TABLE public.invoice_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Scoping (strict)
  establishment_id UUID NOT NULL REFERENCES establishments(id),
  organization_id UUID NOT NULL,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES invoice_suppliers(id),
  year_month TEXT NOT NULL,
  
  -- Schema version for future migrations
  schema_version INTEGER NOT NULL DEFAULT 1,
  
  -- Status lifecycle: pending -> extracting -> extracted -> failed
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'extracting', 'extracted', 'failed')),
  
  -- Full extraction JSON (raw + normalized)
  extraction_json JSONB,
  
  -- Error tracking
  error_message TEXT,
  
  -- Anti-spam / rate limiting
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  
  -- Audit
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- One extraction per invoice
  CONSTRAINT invoice_extractions_invoice_unique UNIQUE (invoice_id)
);

-- Indexes for common queries
CREATE INDEX idx_invoice_extractions_supplier_month 
  ON public.invoice_extractions(supplier_id, year_month);
CREATE INDEX idx_invoice_extractions_establishment 
  ON public.invoice_extractions(establishment_id);
CREATE INDEX idx_invoice_extractions_status 
  ON public.invoice_extractions(status);

-- Enable RLS
ALTER TABLE public.invoice_extractions ENABLE ROW LEVEL SECURITY;

-- RLS Policies (module owner = factures, strict establishment scope)
CREATE POLICY "invoice_extractions_select"
  ON public.invoice_extractions
  FOR SELECT
  USING (has_module_access('factures', 'read'::access_level, establishment_id));

CREATE POLICY "invoice_extractions_insert"
  ON public.invoice_extractions
  FOR INSERT
  WITH CHECK (has_module_access('factures', 'write'::access_level, establishment_id));

CREATE POLICY "invoice_extractions_update"
  ON public.invoice_extractions
  FOR UPDATE
  USING (has_module_access('factures', 'write'::access_level, establishment_id));

CREATE POLICY "invoice_extractions_delete"
  ON public.invoice_extractions
  FOR DELETE
  USING (has_module_access('factures', 'write'::access_level, establishment_id));

-- Trigger for updated_at
CREATE TRIGGER update_invoice_extractions_updated_at
  BEFORE UPDATE ON public.invoice_extractions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime (scoped invalidation)
ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_extractions;