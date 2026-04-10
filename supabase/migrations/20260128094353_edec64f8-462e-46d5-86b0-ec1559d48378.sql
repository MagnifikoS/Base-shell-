-- Add partial extras payment fields to payroll_employee_month_validation
-- extras_paid_eur: amount actually paid on salary (NULL = not set, use total)
-- extras_deferred_minutes: minutes added to counter this month (anti-double-counting lock)

ALTER TABLE public.payroll_employee_month_validation
ADD COLUMN extras_paid_eur NUMERIC(10,2) NULL,
ADD COLUMN extras_deferred_minutes INTEGER NOT NULL DEFAULT 0;

-- Add constraint: if include_extras = false, extras_paid_eur must be NULL
-- This is enforced via trigger for flexibility

CREATE OR REPLACE FUNCTION public.enforce_extras_paid_consistency()
RETURNS TRIGGER AS $$
BEGIN
  -- If include_extras is false, force extras_paid_eur to NULL and extras_deferred_minutes to 0
  IF NEW.include_extras = false THEN
    NEW.extras_paid_eur := NULL;
    NEW.extras_deferred_minutes := 0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_enforce_extras_paid_consistency
BEFORE INSERT OR UPDATE ON public.payroll_employee_month_validation
FOR EACH ROW
EXECUTE FUNCTION public.enforce_extras_paid_consistency();

-- Add comment for documentation
COMMENT ON COLUMN public.payroll_employee_month_validation.extras_paid_eur IS 'Partial amount of extras paid on salary this month (NULL = pay full amount)';
COMMENT ON COLUMN public.payroll_employee_month_validation.extras_deferred_minutes IS 'Minutes added to R-Extra counter this month (anti-double-counting lock)';