-- Supprime le champ legacy cash_amount de employee_details
-- Ce champ n'est plus utilisé : les espèces sont calculées depuis total_salary - net_salary

ALTER TABLE public.employee_details
  DROP COLUMN IF EXISTS cash_amount;