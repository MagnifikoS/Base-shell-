-- =============================================================================
-- CLEANUP: Suppression complète des modes "Reporter" et "Compenser"
-- =============================================================================
-- Cette migration supprime la table et les policies RLS liées au carry M→M+1
-- car les modes "Reporter" et "Compenser" sont définitivement retirés.
-- Seul le mode "Déduire du salaire" reste en vigueur.
-- =============================================================================

-- 1. Supprimer les policies RLS
DROP POLICY IF EXISTS paie_read_carry ON public.payroll_employee_month_carry;
DROP POLICY IF EXISTS paie_insert_carry ON public.payroll_employee_month_carry;
DROP POLICY IF EXISTS paie_update_carry ON public.payroll_employee_month_carry;
DROP POLICY IF EXISTS paie_delete_carry ON public.payroll_employee_month_carry;

-- 2. Supprimer la table
DROP TABLE IF EXISTS public.payroll_employee_month_carry;