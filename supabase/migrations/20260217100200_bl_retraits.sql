-- ═══════════════════════════════════════════════════════════════════════════
-- BL RETRAITS — Delivery note for withdrawals (reporting document only)
-- ═══════════════════════════════════════════════════════════════════════════
-- RULES:
-- - Reporting document ONLY — does NOT create stock events
-- - Linked to a WITHDRAWAL stock_document via stock_document_id
-- - Prices are frozen snapshots at generation time
-- - Sequential numbering: BL-R-XXXXX per establishment

-- 1. bl_retraits table
CREATE TABLE IF NOT EXISTS public.bl_retraits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stock_document_id UUID NOT NULL REFERENCES public.stock_documents(id),
  bl_number TEXT NOT NULL,
  destination_establishment_id UUID REFERENCES public.establishments(id),
  destination_name TEXT,
  total_amount NUMERIC(12, 2),
  status TEXT NOT NULL DEFAULT 'FINAL',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. bl_retrait_lines table
CREATE TABLE IF NOT EXISTS public.bl_retrait_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bl_retrait_id UUID NOT NULL REFERENCES public.bl_retraits(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  product_name_snapshot TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit_label TEXT,
  unit_price NUMERIC(12, 4),
  line_total NUMERIC(12, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. RLS
ALTER TABLE public.bl_retraits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bl_retrait_lines ENABLE ROW LEVEL SECURITY;

-- bl_retraits policies
CREATE POLICY "Users can view bl_retraits in their establishments"
  ON public.bl_retraits FOR SELECT TO authenticated
  USING (public.has_module_access('inventaire', 'read', establishment_id));

CREATE POLICY "Users can insert bl_retraits in their establishments"
  ON public.bl_retraits FOR INSERT TO authenticated
  WITH CHECK (public.has_module_access('inventaire', 'write', establishment_id));

-- bl_retrait_lines policies
CREATE POLICY "Users can view bl_retrait_lines via bl_retrait"
  ON public.bl_retrait_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bl_retraits br
    WHERE br.id = bl_retrait_id
    AND public.has_module_access('inventaire', 'read', br.establishment_id)
  ));

CREATE POLICY "Users can insert bl_retrait_lines for their bl_retraits"
  ON public.bl_retrait_lines FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bl_retraits br
    WHERE br.id = bl_retrait_id
    AND public.has_module_access('inventaire', 'write', br.establishment_id)
  ));

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_bl_retraits_establishment ON public.bl_retraits(establishment_id);
CREATE INDEX IF NOT EXISTS idx_bl_retraits_date ON public.bl_retraits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bl_retraits_stock_doc ON public.bl_retraits(stock_document_id);
CREATE INDEX IF NOT EXISTS idx_bl_retrait_lines_bl ON public.bl_retrait_lines(bl_retrait_id);

-- 5. Sequence for BL numbers per establishment
-- We use a simple counter approach via a function
CREATE OR REPLACE FUNCTION public.fn_next_bl_retrait_number(p_establishment_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO v_count
  FROM public.bl_retraits
  WHERE establishment_id = p_establishment_id;

  RETURN 'BL-R-' || LPAD(v_count::TEXT, 5, '0');
END;
$$;
