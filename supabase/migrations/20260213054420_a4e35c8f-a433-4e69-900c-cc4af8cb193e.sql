
-- ═══════════════════════════════════════════════════════════════════════════
-- MODULE STOCK VALUATION — Tables for monthly stock snapshots in EUR
-- ═══════════════════════════════════════════════════════════════════════════

-- Table 1: Monthly stock value snapshots (header)
CREATE TABLE public.stock_monthly_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  snapshot_version_id UUID NOT NULL,
  snapshot_date DATE NOT NULL,
  total_stock_value_eur NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  CONSTRAINT uq_stock_monthly_snapshot UNIQUE (establishment_id, snapshot_date)
);

-- Table 2: Monthly snapshot detail lines (per product)
CREATE TABLE public.stock_monthly_snapshot_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_id UUID NOT NULL REFERENCES public.stock_monthly_snapshots(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  quantity_canonical NUMERIC NOT NULL DEFAULT 0,
  canonical_unit_id UUID REFERENCES public.measurement_units(id),
  unit_price_eur NUMERIC(14,4) NOT NULL DEFAULT 0,
  total_value_eur NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_stock_monthly_snapshots_est ON public.stock_monthly_snapshots(establishment_id);
CREATE INDEX idx_stock_monthly_snapshot_lines_snapshot ON public.stock_monthly_snapshot_lines(snapshot_id);

-- RLS
ALTER TABLE public.stock_monthly_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_monthly_snapshot_lines ENABLE ROW LEVEL SECURITY;

-- Policies: read access for org members
CREATE POLICY "Users can view stock monthly snapshots"
  ON public.stock_monthly_snapshots FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can insert stock monthly snapshots"
  ON public.stock_monthly_snapshots FOR INSERT
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can view stock monthly snapshot lines"
  ON public.stock_monthly_snapshot_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stock_monthly_snapshots s
      WHERE s.id = snapshot_id
        AND s.organization_id = public.get_user_organization_id()
    )
  );

CREATE POLICY "Users can insert stock monthly snapshot lines"
  ON public.stock_monthly_snapshot_lines FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stock_monthly_snapshots s
      WHERE s.id = snapshot_id
        AND s.organization_id = public.get_user_organization_id()
    )
  );
