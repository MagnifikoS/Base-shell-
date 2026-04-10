-- PHASE 1: Add cash_amount column to employee_details
ALTER TABLE public.employee_details
  ADD COLUMN IF NOT EXISTS cash_amount numeric DEFAULT NULL;

COMMENT ON COLUMN public.employee_details.cash_amount
  IS 'Espèces: montant mensuel payé en cash (saisie manuelle, SSOT transitoire)';