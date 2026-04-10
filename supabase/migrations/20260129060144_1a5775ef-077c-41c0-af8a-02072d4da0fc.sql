-- ═══════════════════════════════════════════════════════════════════════════════
-- CLEANUP: R-EXTRA SSOT UNIFICATION
-- ═══════════════════════════════════════════════════════════════════════════════
-- 
-- Suppression des sources de vérité orphelines et unification sur le calcul on-the-fly.
-- R-Extra = total_extras_détectés - total_extras_payés - total_rextra_consommés
-- 
-- Cette migration:
-- 1. DROP TABLE payroll_employee_extra_counter (compteur cumulatif orphelin)
-- 2. DROP COLUMN extras_deferred_minutes de payroll_employee_month_validation
-- 3. Simplifie le trigger enforce_extras_paid_consistency
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Drop orphan table and related objects
DROP TRIGGER IF EXISTS update_payroll_extra_counter_updated_at ON public.payroll_employee_extra_counter;
DROP INDEX IF EXISTS idx_payroll_extra_counter_establishment;
DROP TABLE IF EXISTS public.payroll_employee_extra_counter;

-- 2. Drop the extras_deferred_minutes column
ALTER TABLE public.payroll_employee_month_validation 
  DROP COLUMN IF EXISTS extras_deferred_minutes;

-- 3. Update the trigger to only handle include_extras → extras_paid_eur consistency
CREATE OR REPLACE FUNCTION public.enforce_extras_paid_consistency()
RETURNS TRIGGER AS $$
BEGIN
  -- If include_extras is false, force extras_paid_eur to NULL
  IF NEW.include_extras = false THEN
    NEW.extras_paid_eur := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = 'public';

-- Update comments for documentation
COMMENT ON COLUMN public.payroll_employee_month_validation.extras_paid_eur IS 'Partial amount of extras paid on salary this month (NULL = pay full amount). R-Extra balance is calculated dynamically: detected - paid - consumed.';
