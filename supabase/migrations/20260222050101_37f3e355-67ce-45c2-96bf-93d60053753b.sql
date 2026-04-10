
-- Add missing partial payment columns to payroll_employee_month_validation
ALTER TABLE public.payroll_employee_month_validation
ADD COLUMN IF NOT EXISTS net_amount_paid NUMERIC NULL,
ADD COLUMN IF NOT EXISTS cash_amount_paid NUMERIC NULL;
