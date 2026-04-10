-- Add partial payment amount columns for payroll
-- Allows tracking partial virement and especes payments instead of just boolean paid/not-paid

ALTER TABLE public.payroll_employee_month_validation
  ADD COLUMN IF NOT EXISTS net_amount_paid NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS cash_amount_paid NUMERIC(12, 2);

-- Add CHECK constraints to ensure amounts are non-negative (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_net_amount_paid_positive'
  ) THEN
    ALTER TABLE public.payroll_employee_month_validation
      ADD CONSTRAINT chk_net_amount_paid_positive CHECK (net_amount_paid IS NULL OR net_amount_paid >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_cash_amount_paid_positive'
  ) THEN
    ALTER TABLE public.payroll_employee_month_validation
      ADD CONSTRAINT chk_cash_amount_paid_positive CHECK (cash_amount_paid IS NULL OR cash_amount_paid >= 0);
  END IF;
END $$;
