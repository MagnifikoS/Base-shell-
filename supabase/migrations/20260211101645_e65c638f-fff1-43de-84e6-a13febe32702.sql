
-- Migration: Add notes + usage_category to measurement_units for Settings V2 UI

-- 1. Add notes column (free text for user remarks)
ALTER TABLE public.measurement_units
  ADD COLUMN IF NOT EXISTS notes text DEFAULT NULL;

-- 2. Add usage_category column (structured usage context)
-- Values: 'supplier' | 'stock' | 'recipe' | 'reference' | 'general'
ALTER TABLE public.measurement_units
  ADD COLUMN IF NOT EXISTS usage_category text NOT NULL DEFAULT 'general';

-- 3. Backfill usage_category from existing data:
-- Units with is_reference = true → 'reference'
UPDATE public.measurement_units
SET usage_category = 'reference'
WHERE is_reference = true AND usage_category = 'general';

-- Units with category = 'packaging' → 'stock' (used for inventory manipulation)
UPDATE public.measurement_units
SET usage_category = 'stock'
WHERE category = 'packaging' AND usage_category = 'general';

-- Physical units (weight/volume family) → 'supplier' (commonly used on invoices)
UPDATE public.measurement_units
SET usage_category = 'supplier'
WHERE family IN ('weight', 'volume') AND usage_category = 'general';
