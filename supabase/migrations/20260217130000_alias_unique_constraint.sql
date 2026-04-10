-- ═══════════════════════════════════════════════════════════════════════════
-- ALIAS-01: Add UNIQUE constraint on supplier_name_aliases(alias_norm, establishment_id)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Finding: alias_raw accepts any text with no uniqueness constraint.
-- Two different suppliers could be mapped to the same normalized alias
-- within the same establishment, causing incorrect auto-matching.
--
-- Fix: Add a UNIQUE constraint so each normalized alias maps to exactly
-- one supplier per establishment.
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the existing non-unique index first (it will be replaced by the unique constraint)
DROP INDEX IF EXISTS public.idx_supplier_name_aliases_alias_norm;

-- Add UNIQUE constraint (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_alias_norm_establishment'
  ) THEN
    ALTER TABLE public.supplier_name_aliases
      ADD CONSTRAINT uq_alias_norm_establishment UNIQUE (alias_norm, establishment_id);
  END IF;
END $$;
