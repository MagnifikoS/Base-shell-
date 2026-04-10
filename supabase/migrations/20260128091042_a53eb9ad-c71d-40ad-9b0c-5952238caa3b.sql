-- ═══════════════════════════════════════════════════════════════════════════
-- PAYROLL EXTRA COUNTER TABLE
-- SSOT for cumulative deferred extras (minutes only, not euros)
-- ═══════════════════════════════════════════════════════════════════════════

-- Create table for extra counter (unique per establishment + user)
CREATE TABLE public.payroll_employee_extra_counter (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  extra_counter_minutes INTEGER NOT NULL DEFAULT 0 CHECK (extra_counter_minutes >= 0),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID NOT NULL,
  CONSTRAINT payroll_employee_extra_counter_unique UNIQUE (establishment_id, user_id)
);

-- Index for fast lookups by establishment
CREATE INDEX idx_payroll_extra_counter_establishment 
  ON public.payroll_employee_extra_counter(establishment_id);

-- Enable RLS
ALTER TABLE public.payroll_employee_extra_counter ENABLE ROW LEVEL SECURITY;

-- SELECT: users with paie:read access for the establishment
CREATE POLICY "Users with paie read can view extra counter"
  ON public.payroll_employee_extra_counter
  FOR SELECT
  USING (
    public.has_module_access('paie', 'read', establishment_id)
  );

-- INSERT: users with paie:write access for the establishment
CREATE POLICY "Users with paie write can create extra counter"
  ON public.payroll_employee_extra_counter
  FOR INSERT
  WITH CHECK (
    public.has_module_access('paie', 'write', establishment_id)
    AND updated_by = auth.uid()
  );

-- UPDATE: users with paie:write access for the establishment
CREATE POLICY "Users with paie write can update extra counter"
  ON public.payroll_employee_extra_counter
  FOR UPDATE
  USING (
    public.has_module_access('paie', 'write', establishment_id)
  )
  WITH CHECK (
    public.has_module_access('paie', 'write', establishment_id)
    AND updated_by = auth.uid()
  );

-- DELETE: users with paie:write access (for reset if needed)
CREATE POLICY "Users with paie write can delete extra counter"
  ON public.payroll_employee_extra_counter
  FOR DELETE
  USING (
    public.has_module_access('paie', 'write', establishment_id)
  );

-- Trigger for updated_at
CREATE TRIGGER update_payroll_extra_counter_updated_at
  BEFORE UPDATE ON public.payroll_employee_extra_counter
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();