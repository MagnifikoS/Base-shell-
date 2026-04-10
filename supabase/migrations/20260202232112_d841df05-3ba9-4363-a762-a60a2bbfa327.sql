-- ═══════════════════════════════════════════════════════════════════════
-- SUPPLIER MONTHLY RECONCILIATIONS
-- Tracks statement validation status per supplier/month
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE public.supplier_monthly_reconciliations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.invoice_suppliers(id) ON DELETE CASCADE,
  year_month TEXT NOT NULL, -- YYYY-MM (Paris timezone)
  
  -- Amounts
  statement_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  matched_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  missing_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  delta_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  
  -- Counts
  statement_entry_count INT NOT NULL DEFAULT 0,
  matched_count INT NOT NULL DEFAULT 0,
  missing_count INT NOT NULL DEFAULT 0,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'needs_missing_invoices')),
  
  -- Source extraction (optional, stores the statement extraction JSON)
  source_extraction_json JSONB DEFAULT NULL,
  source_file_path TEXT DEFAULT NULL,
  
  -- Audit
  validated_by UUID DEFAULT NULL,
  validated_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Unique constraint: one reconciliation per supplier/month/establishment
  CONSTRAINT unique_supplier_month_reconciliation 
    UNIQUE (establishment_id, supplier_id, year_month)
);

-- Indexes for performance
CREATE INDEX idx_reconciliations_establishment ON public.supplier_monthly_reconciliations(establishment_id);
CREATE INDEX idx_reconciliations_supplier ON public.supplier_monthly_reconciliations(supplier_id);
CREATE INDEX idx_reconciliations_year_month ON public.supplier_monthly_reconciliations(year_month);
CREATE INDEX idx_reconciliations_status ON public.supplier_monthly_reconciliations(status);

-- Enable RLS
ALTER TABLE public.supplier_monthly_reconciliations ENABLE ROW LEVEL SECURITY;

-- RLS Policies (scoped to establishment)
CREATE POLICY "Users can view reconciliations for their establishments" 
ON public.supplier_monthly_reconciliations 
FOR SELECT 
USING (establishment_id IN (SELECT get_user_establishment_ids()));

CREATE POLICY "Users can insert reconciliations for their establishments" 
ON public.supplier_monthly_reconciliations 
FOR INSERT 
WITH CHECK (establishment_id IN (SELECT get_user_establishment_ids()));

CREATE POLICY "Users can update reconciliations for their establishments" 
ON public.supplier_monthly_reconciliations 
FOR UPDATE 
USING (establishment_id IN (SELECT get_user_establishment_ids()));

CREATE POLICY "Users can delete reconciliations for their establishments" 
ON public.supplier_monthly_reconciliations 
FOR DELETE 
USING (establishment_id IN (SELECT get_user_establishment_ids()));

-- Trigger for updated_at
CREATE TRIGGER update_supplier_monthly_reconciliations_updated_at
BEFORE UPDATE ON public.supplier_monthly_reconciliations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();