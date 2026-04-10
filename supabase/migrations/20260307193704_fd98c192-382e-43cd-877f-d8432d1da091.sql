
-- ═══════════════════════════════════════════════════════════════
-- MODULE: ecartsInventaire — Isolated discrepancy tracking
-- ═══════════════════════════════════════════════════════════════

-- 0. Trigger function for updated_at
CREATE OR REPLACE FUNCTION public.trg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 1. Enum for discrepancy status
DO $$ BEGIN
  CREATE TYPE public.discrepancy_status AS ENUM ('open', 'analyzed', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Main table
CREATE TABLE IF NOT EXISTS public.inventory_discrepancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products_v2(id) ON DELETE CASCADE,
  storage_zone_id UUID REFERENCES public.storage_zones(id) ON DELETE SET NULL,
  withdrawal_quantity NUMERIC NOT NULL,
  estimated_stock_before NUMERIC NOT NULL,
  gap_quantity NUMERIC NOT NULL,
  canonical_unit_id UUID REFERENCES public.measurement_units(id),
  withdrawn_by UUID,
  withdrawn_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawal_reason TEXT,
  source_document_id UUID,
  source_type TEXT NOT NULL DEFAULT 'withdrawal',
  status public.discrepancy_status NOT NULL DEFAULT 'open',
  resolution_note TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_discrepancies_establishment ON public.inventory_discrepancies(establishment_id);
CREATE INDEX IF NOT EXISTS idx_discrepancies_product ON public.inventory_discrepancies(product_id);
CREATE INDEX IF NOT EXISTS idx_discrepancies_status ON public.inventory_discrepancies(establishment_id, status);
CREATE INDEX IF NOT EXISTS idx_discrepancies_withdrawn_at ON public.inventory_discrepancies(establishment_id, withdrawn_at DESC);

-- 4. RLS
ALTER TABLE public.inventory_discrepancies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "discrepancies_select" ON public.inventory_discrepancies FOR SELECT TO authenticated
  USING (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue WHERE ue.user_id = auth.uid()
    )
  );

CREATE POLICY "discrepancies_insert" ON public.inventory_discrepancies FOR INSERT TO authenticated
  WITH CHECK (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue WHERE ue.user_id = auth.uid()
    )
  );

CREATE POLICY "discrepancies_update" ON public.inventory_discrepancies FOR UPDATE TO authenticated
  USING (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue WHERE ue.user_id = auth.uid()
    )
  )
  WITH CHECK (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue WHERE ue.user_id = auth.uid()
    )
  );

-- 5. Trigger
CREATE TRIGGER trg_updated_at_inventory_discrepancies
  BEFORE UPDATE ON public.inventory_discrepancies
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_set_updated_at();
