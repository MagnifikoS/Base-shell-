-- ═══════════════════════════════════════════════════════════════════════════
-- MODULE FACTURES V1 - Tables + Storage + RLS + Realtime
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) STORAGE BUCKET for invoices
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies for invoices bucket
CREATE POLICY "Users can view invoice files in their establishments"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'invoices'
  AND public.has_module_access('factures', 'read', 
    (string_to_array(name, '/'))[2]::uuid)
);

CREATE POLICY "Users can upload invoice files to their establishments"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'invoices'
  AND public.has_module_access('factures', 'write', 
    (string_to_array(name, '/'))[2]::uuid)
);

CREATE POLICY "Users can delete invoice files in their establishments"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'invoices'
  AND public.has_module_access('factures', 'write', 
    (string_to_array(name, '/'))[2]::uuid)
);

-- 2) MODULE KEY for RBAC
INSERT INTO public.modules (key, name, display_order)
VALUES ('factures', 'Factures', 85)
ON CONFLICT (key) DO NOTHING;

-- 3) INVOICE SUPPLIERS TABLE
CREATE TABLE public.invoice_suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (establishment_id, name)
);

ALTER TABLE public.invoice_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view suppliers in their establishments"
ON public.invoice_suppliers FOR SELECT
USING (public.has_module_access('factures', 'read', establishment_id));

CREATE POLICY "Users can create suppliers in their establishments"
ON public.invoice_suppliers FOR INSERT
WITH CHECK (public.has_module_access('factures', 'write', establishment_id));

CREATE POLICY "Users can update suppliers in their establishments"
ON public.invoice_suppliers FOR UPDATE
USING (public.has_module_access('factures', 'write', establishment_id));

CREATE POLICY "Users can delete suppliers in their establishments"
ON public.invoice_suppliers FOR DELETE
USING (public.has_module_access('factures', 'write', establishment_id));

CREATE TRIGGER update_invoice_suppliers_updated_at
BEFORE UPDATE ON public.invoice_suppliers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) INVOICES TABLE
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.invoice_suppliers(id) ON DELETE CASCADE,
  invoice_date DATE NOT NULL,
  amount_eur NUMERIC(12, 2) NOT NULL CHECK (amount_eur >= 0),
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_type TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view invoices in their establishments"
ON public.invoices FOR SELECT
USING (public.has_module_access('factures', 'read', establishment_id));

CREATE POLICY "Users can create invoices in their establishments"
ON public.invoices FOR INSERT
WITH CHECK (public.has_module_access('factures', 'write', establishment_id));

CREATE POLICY "Users can update invoices in their establishments"
ON public.invoices FOR UPDATE
USING (public.has_module_access('factures', 'write', establishment_id));

CREATE POLICY "Users can delete invoices in their establishments"
ON public.invoices FOR DELETE
USING (public.has_module_access('factures', 'write', establishment_id));

CREATE TRIGGER update_invoices_updated_at
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_invoices_establishment_date ON public.invoices(establishment_id, invoice_date);
CREATE INDEX idx_invoices_supplier_date ON public.invoices(supplier_id, invoice_date);

-- 5) INVOICE MONTHLY STATEMENTS TABLE
CREATE TABLE public.invoice_monthly_statements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.invoice_suppliers(id) ON DELETE CASCADE,
  year_month TEXT NOT NULL CHECK (year_month ~ '^\d{4}-\d{2}$'),
  statement_amount_eur NUMERIC(12, 2) NOT NULL CHECK (statement_amount_eur >= 0),
  gap_eur NUMERIC(12, 2),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('ok', 'gap', 'pending')),
  payment_date DATE,
  file_path TEXT,
  file_name TEXT,
  file_size INTEGER,
  file_type TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (establishment_id, supplier_id, year_month)
);

ALTER TABLE public.invoice_monthly_statements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view statements in their establishments"
ON public.invoice_monthly_statements FOR SELECT
USING (public.has_module_access('factures', 'read', establishment_id));

CREATE POLICY "Users can create statements in their establishments"
ON public.invoice_monthly_statements FOR INSERT
WITH CHECK (public.has_module_access('factures', 'write', establishment_id));

CREATE POLICY "Users can update statements in their establishments"
ON public.invoice_monthly_statements FOR UPDATE
USING (public.has_module_access('factures', 'write', establishment_id));

CREATE POLICY "Users can delete statements in their establishments"
ON public.invoice_monthly_statements FOR DELETE
USING (public.has_module_access('factures', 'write', establishment_id));

CREATE TRIGGER update_invoice_monthly_statements_updated_at
BEFORE UPDATE ON public.invoice_monthly_statements
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_statements_establishment_month ON public.invoice_monthly_statements(establishment_id, year_month);
CREATE INDEX idx_statements_supplier_month ON public.invoice_monthly_statements(supplier_id, year_month);

-- 6) ENABLE REALTIME for all 3 tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_suppliers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;
ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_monthly_statements;