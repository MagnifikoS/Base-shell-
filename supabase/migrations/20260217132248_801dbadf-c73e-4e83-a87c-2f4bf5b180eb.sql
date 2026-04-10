
-- ═══════════════════════════════════════════════════════════════════════════
-- BL Retrait — Tables de reporting documentaire pour les retraits de stock
-- Miroir de bl_app_documents/bl_app_lines mais pour les WITHDRAWAL
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. BL Withdrawal Documents
CREATE TABLE IF NOT EXISTS public.bl_withdrawal_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  stock_document_id UUID NOT NULL REFERENCES public.stock_documents(id),
  destination_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  bl_number TEXT NOT NULL,
  bl_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_eur NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(stock_document_id)
);

-- 2. BL Withdrawal Lines
CREATE TABLE IF NOT EXISTS public.bl_withdrawal_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bl_withdrawal_document_id UUID NOT NULL REFERENCES public.bl_withdrawal_documents(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  product_name_snapshot TEXT NOT NULL,
  quantity_canonical NUMERIC(12,4) NOT NULL,
  canonical_unit_id UUID NOT NULL REFERENCES public.measurement_units(id),
  unit_price_snapshot NUMERIC(12,4),
  line_total_snapshot NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. RLS
ALTER TABLE IF EXISTS public.bl_withdrawal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bl_withdrawal_lines ENABLE ROW LEVEL SECURITY;

-- Documents: users in same org can read/insert
DROP POLICY IF EXISTS "Users can view bl_withdrawal_documents in their org" ON public.bl_withdrawal_documents;
CREATE POLICY "Users can view bl_withdrawal_documents in their org"
  ON public.bl_withdrawal_documents FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create bl_withdrawal_documents in their org" ON public.bl_withdrawal_documents;
CREATE POLICY "Users can create bl_withdrawal_documents in their org"
  ON public.bl_withdrawal_documents FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

-- Lines: access via parent document
DROP POLICY IF EXISTS "Users can view bl_withdrawal_lines via parent doc" ON public.bl_withdrawal_lines;
CREATE POLICY "Users can view bl_withdrawal_lines via parent doc"
  ON public.bl_withdrawal_lines FOR SELECT
  USING (
    bl_withdrawal_document_id IN (
      SELECT id FROM public.bl_withdrawal_documents
      WHERE organization_id IN (
        SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Users can create bl_withdrawal_lines via parent doc" ON public.bl_withdrawal_lines;
CREATE POLICY "Users can create bl_withdrawal_lines via parent doc"
  ON public.bl_withdrawal_lines FOR INSERT
  WITH CHECK (
    bl_withdrawal_document_id IN (
      SELECT id FROM public.bl_withdrawal_documents
      WHERE organization_id IN (
        SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
      )
    )
  );

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_bl_withdrawal_documents_establishment ON public.bl_withdrawal_documents(establishment_id);
CREATE INDEX IF NOT EXISTS idx_bl_withdrawal_documents_bl_date ON public.bl_withdrawal_documents(bl_date);
CREATE INDEX IF NOT EXISTS idx_bl_withdrawal_lines_document ON public.bl_withdrawal_lines(bl_withdrawal_document_id);
