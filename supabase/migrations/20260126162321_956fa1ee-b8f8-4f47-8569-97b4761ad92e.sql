-- ============================================================================
-- PHASE P0: payroll_employee_month_carry — SSOT heures dues (report M → M+1)
-- Structure uniquement, aucune automatisation
-- ============================================================================

-- Create table for carrying hours between months (manual/admin decision only)
CREATE TABLE IF NOT EXISTS public.payroll_employee_month_carry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  year_month TEXT NOT NULL, -- format YYYY-MM
  
  carry_minutes INTEGER NOT NULL CHECK (carry_minutes >= 0), -- toujours positif
  source TEXT NOT NULL CHECK (source IN ('carry_from_previous', 'manual_adjustment')),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,

  UNIQUE (establishment_id, user_id, year_month)
);

-- Enable RLS
ALTER TABLE public.payroll_employee_month_carry ENABLE ROW LEVEL SECURITY;

-- RLS: SELECT → paie:read (scoped to establishment)
CREATE POLICY "paie_read_carry"
  ON public.payroll_employee_month_carry
  FOR SELECT
  USING (
    has_module_access('paie'::text, 'read'::access_level, establishment_id)
  );

-- RLS: INSERT → paie:write AND created_by = auth.uid()
CREATE POLICY "paie_insert_carry"
  ON public.payroll_employee_month_carry
  FOR INSERT
  WITH CHECK (
    has_module_access('paie'::text, 'write'::access_level, establishment_id)
    AND created_by = auth.uid()
  );

-- RLS: UPDATE → paie:write (keep created_by intact for audit)
CREATE POLICY "paie_update_carry"
  ON public.payroll_employee_month_carry
  FOR UPDATE
  USING (
    has_module_access('paie'::text, 'write'::access_level, establishment_id)
  )
  WITH CHECK (
    has_module_access('paie'::text, 'write'::access_level, establishment_id)
  );

-- RLS: DELETE → paie:write
CREATE POLICY "paie_delete_carry"
  ON public.payroll_employee_month_carry
  FOR DELETE
  USING (
    has_module_access('paie'::text, 'write'::access_level, establishment_id)
  );

-- Index for fast lookup by establishment + month
CREATE INDEX IF NOT EXISTS idx_payroll_carry_estab_month 
  ON public.payroll_employee_month_carry(establishment_id, year_month);