-- ═══════════════════════════════════════════════════════════════════════════
-- SUPPLIER EXTRACTED PRODUCTS — Brouillon extraction IA
-- Module: Factures / Extraction Produits (isolation totale)
-- ═══════════════════════════════════════════════════════════════════════════

-- Table for storing extracted products (draft and validated)
CREATE TABLE public.supplier_extracted_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.invoice_suppliers(id) ON DELETE CASCADE,
  
  -- Core product data (only 3 fields as specified)
  product_name TEXT NOT NULL,
  conditioning TEXT NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  
  -- Status: draft = not validated, validated = user confirmed
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated')),
  
  -- Source tracking
  source TEXT NOT NULL DEFAULT 'extraction_factures',
  year_month TEXT NOT NULL, -- YYYY-MM — month from which extraction was done
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID,
  validated_at TIMESTAMP WITH TIME ZONE,
  validated_by UUID
);

-- Index for efficient queries
CREATE INDEX idx_supplier_extracted_products_supplier_month 
  ON public.supplier_extracted_products(supplier_id, year_month);
CREATE INDEX idx_supplier_extracted_products_establishment 
  ON public.supplier_extracted_products(establishment_id);
CREATE INDEX idx_supplier_extracted_products_status 
  ON public.supplier_extracted_products(status);

-- Enable RLS
ALTER TABLE public.supplier_extracted_products ENABLE ROW LEVEL SECURITY;

-- RLS Policies: signature: has_module_access(_module_key, _min_level, _establishment_id)
CREATE POLICY "supplier_extracted_products_select" 
ON public.supplier_extracted_products 
FOR SELECT 
USING (
  has_module_access('factures', 'read'::access_level, establishment_id)
);

CREATE POLICY "supplier_extracted_products_insert" 
ON public.supplier_extracted_products 
FOR INSERT 
WITH CHECK (
  has_module_access('factures', 'write'::access_level, establishment_id)
);

CREATE POLICY "supplier_extracted_products_update" 
ON public.supplier_extracted_products 
FOR UPDATE 
USING (
  has_module_access('factures', 'write'::access_level, establishment_id)
);

CREATE POLICY "supplier_extracted_products_delete" 
ON public.supplier_extracted_products 
FOR DELETE 
USING (
  has_module_access('factures', 'write'::access_level, establishment_id)
);

-- Trigger for updated_at
CREATE TRIGGER update_supplier_extracted_products_updated_at
BEFORE UPDATE ON public.supplier_extracted_products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();