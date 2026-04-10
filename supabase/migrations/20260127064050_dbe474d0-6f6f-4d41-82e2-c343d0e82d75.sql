-- Add cash_paid column to payroll_employee_month_validation table
ALTER TABLE public.payroll_employee_month_validation
ADD COLUMN IF NOT EXISTS cash_paid BOOLEAN NOT NULL DEFAULT false;