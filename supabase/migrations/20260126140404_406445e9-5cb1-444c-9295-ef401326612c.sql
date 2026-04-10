-- Align DELETE policy on payroll_employee_month_validation with RBAC V2 pattern
-- Replace is_admin() with has_module_access('paie', 'write', establishment_id)

DROP POLICY IF EXISTS paie_delete_validation ON public.payroll_employee_month_validation;

CREATE POLICY paie_delete_validation
ON public.payroll_employee_month_validation
FOR DELETE
USING (has_module_access('paie', 'write'::access_level, establishment_id));