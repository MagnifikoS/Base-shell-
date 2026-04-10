-- Add net_paid column to payroll_employee_month_validation
ALTER TABLE public.payroll_employee_month_validation
ADD COLUMN net_paid boolean NOT NULL DEFAULT false;