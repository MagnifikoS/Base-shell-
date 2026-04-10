ALTER TABLE public.employee_details
  ADD COLUMN IF NOT EXISTS total_salary numeric DEFAULT NULL;

COMMENT ON COLUMN public.employee_details.total_salary
  IS 'Salaire total mensuel (net + espèces). Saisi manuellement. SSOT transitoire.';