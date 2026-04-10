-- HOTFIX P0: Anti-bypass RLS UPDATE pour payroll_employee_month_carry
-- Un writer ne peut modifier QUE les lignes qu'il a créées (audit fort)

DROP POLICY IF EXISTS paie_update_carry ON public.payroll_employee_month_carry;

CREATE POLICY paie_update_carry ON public.payroll_employee_month_carry
  FOR UPDATE 
  USING (has_module_access('paie', 'write', establishment_id))
  WITH CHECK (
    has_module_access('paie', 'write', establishment_id) 
    AND created_by = auth.uid()
  );