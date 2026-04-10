
-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTAPE 3.1 — Add unit ID columns to products_v2 (SSOT unit references)
-- ═══════════════════════════════════════════════════════════════════════════

-- A) Add new FK columns
ALTER TABLE public.products_v2
  ADD COLUMN IF NOT EXISTS final_unit_id uuid REFERENCES public.measurement_units(id),
  ADD COLUMN IF NOT EXISTS supplier_billing_unit_id uuid REFERENCES public.measurement_units(id),
  ADD COLUMN IF NOT EXISTS stock_handling_unit_id uuid REFERENCES public.measurement_units(id);

-- B) Indexes for performance
CREATE INDEX IF NOT EXISTS idx_products_v2_final_unit_id ON public.products_v2(final_unit_id);
CREATE INDEX IF NOT EXISTS idx_products_v2_supplier_billing_unit_id ON public.products_v2(supplier_billing_unit_id);
CREATE INDEX IF NOT EXISTS idx_products_v2_stock_handling_unit_id ON public.products_v2(stock_handling_unit_id);

-- C) Migrate existing text values to IDs where possible
-- Match final_unit text → measurement_units by name or abbreviation (same establishment)
UPDATE public.products_v2 p
SET final_unit_id = mu.id
FROM public.measurement_units mu
WHERE p.final_unit IS NOT NULL
  AND p.final_unit_id IS NULL
  AND p.establishment_id = mu.establishment_id
  AND mu.is_active = true
  AND (
    lower(mu.name) = lower(p.final_unit)
    OR lower(mu.abbreviation) = lower(p.final_unit)
  );

-- Match supplier_billing_unit text → measurement_units by name or abbreviation (same establishment)
UPDATE public.products_v2 p
SET supplier_billing_unit_id = mu.id
FROM public.measurement_units mu
WHERE p.supplier_billing_unit IS NOT NULL
  AND p.supplier_billing_unit_id IS NULL
  AND p.establishment_id = mu.establishment_id
  AND mu.is_active = true
  AND (
    lower(mu.name) = lower(p.supplier_billing_unit)
    OR lower(mu.abbreviation) = lower(p.supplier_billing_unit)
  );
