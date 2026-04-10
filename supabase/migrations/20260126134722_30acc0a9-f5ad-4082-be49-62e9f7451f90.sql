-- ============================================================
-- PAYROLL EMPLOYEE MONTH VALIDATION
-- Table pour la validation manuelle des extras/absences/déductions
-- par salarié et par mois dans le module Paie
-- ============================================================

-- 1. Create table (idempotent)
CREATE TABLE IF NOT EXISTS public.payroll_employee_month_validation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  year_month TEXT NOT NULL,
  
  include_extras BOOLEAN NOT NULL DEFAULT false,
  include_absences BOOLEAN NOT NULL DEFAULT false,
  include_deductions BOOLEAN NOT NULL DEFAULT false,
  
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NOT NULL,
  
  UNIQUE (establishment_id, user_id, year_month)
);

-- 2. Create indexes for performance
CREATE INDEX IF NOT EXISTS pemv_est_month_idx 
  ON public.payroll_employee_month_validation (establishment_id, year_month);

CREATE INDEX IF NOT EXISTS pemv_user_idx 
  ON public.payroll_employee_month_validation (user_id);

-- 3. Enable RLS
ALTER TABLE public.payroll_employee_month_validation ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies (RBAC scoped to paie module)

-- SELECT: Users with paie:read access on the establishment
CREATE POLICY "paie_read_validation"
  ON public.payroll_employee_month_validation
  FOR SELECT
  USING (has_module_access('paie', 'read'::access_level, establishment_id));

-- INSERT: Users with paie:write access on the establishment AND updated_by = auth.uid()
CREATE POLICY "paie_insert_validation"
  ON public.payroll_employee_month_validation
  FOR INSERT
  WITH CHECK (
    has_module_access('paie', 'write'::access_level, establishment_id)
    AND updated_by = auth.uid()
  );

-- UPDATE: Users with paie:write access on the establishment AND updated_by = auth.uid()
CREATE POLICY "paie_update_validation"
  ON public.payroll_employee_month_validation
  FOR UPDATE
  USING (has_module_access('paie', 'write'::access_level, establishment_id))
  WITH CHECK (
    has_module_access('paie', 'write'::access_level, establishment_id)
    AND updated_by = auth.uid()
  );

-- DELETE: Only admins (rare use case)
CREATE POLICY "paie_delete_validation"
  ON public.payroll_employee_month_validation
  FOR DELETE
  USING (is_admin(auth.uid()));