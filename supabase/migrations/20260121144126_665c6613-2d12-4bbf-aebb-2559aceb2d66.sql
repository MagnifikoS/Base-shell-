-- =====================================================
-- CASH DAY REPORTS TABLE - Phase 0 Caisse Module
-- Single source of truth: 1 row = 1 establishment + 1 business day
-- =====================================================

-- Create table
CREATE TABLE public.cash_day_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  day_date date NOT NULL,
  cb_eur numeric NOT NULL DEFAULT 0,
  cash_eur numeric NOT NULL DEFAULT 0,
  delivery_eur numeric NOT NULL DEFAULT 0,
  courses_eur numeric NOT NULL DEFAULT 0,
  maintenance_eur numeric NOT NULL DEFAULT 0,
  shortage_eur numeric NOT NULL DEFAULT 0,
  total_eur numeric NOT NULL DEFAULT 0,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one report per establishment per day
ALTER TABLE public.cash_day_reports 
  ADD CONSTRAINT cash_day_reports_establishment_day_unique 
  UNIQUE (establishment_id, day_date);

-- Index for fast lookups
CREATE INDEX idx_cash_day_reports_establishment_day 
  ON public.cash_day_reports(establishment_id, day_date);

-- Enable RLS
ALTER TABLE public.cash_day_reports ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user has cash permission with specific scope
-- Uses permission_scope enum casting
CREATE OR REPLACE FUNCTION public.has_cash_permission(_user_id uuid, _scope permission_scope)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = _user_id
      AND rp.module_key = 'caisse'
      AND rp.access_level IN ('read', 'write', 'full')
      AND rp.scope = _scope
  )
$$;

-- Helper function to check if user can write to cash
CREATE OR REPLACE FUNCTION public.can_write_cash(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = _user_id
      AND rp.module_key = 'caisse'
      AND rp.access_level IN ('write', 'full')
  )
$$;

-- Helper function to get business day (03:00 Paris rollover)
-- Returns the business day date for a given timestamp
CREATE OR REPLACE FUNCTION public.get_business_day(_ts timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE 
    WHEN EXTRACT(HOUR FROM (_ts AT TIME ZONE 'Europe/Paris')) < 3 
    THEN ((_ts AT TIME ZONE 'Europe/Paris') - INTERVAL '1 day')::date
    ELSE (_ts AT TIME ZONE 'Europe/Paris')::date
  END
$$;

-- RLS Policy: SELECT
-- User can read if:
-- 1. Admin, OR
-- 2. User belongs to establishment AND has caisse_day or caisse_month permission
CREATE POLICY "Users can view cash reports for their establishments"
ON public.cash_day_reports
FOR SELECT
USING (
  is_admin(auth.uid())
  OR (
    establishment_id IN (SELECT get_user_establishment_ids())
    AND (
      has_cash_permission(auth.uid(), 'caisse_day'::permission_scope)
      OR has_cash_permission(auth.uid(), 'caisse_month'::permission_scope)
    )
  )
);

-- RLS Policy: INSERT
-- User can insert if:
-- 1. Admin, OR
-- 2. User belongs to establishment AND can write cash AND:
--    - has caisse_month (any day), OR
--    - has caisse_day AND day_date = today's business day
CREATE POLICY "Users can insert cash reports with proper permissions"
ON public.cash_day_reports
FOR INSERT
WITH CHECK (
  is_admin(auth.uid())
  OR (
    establishment_id IN (SELECT get_user_establishment_ids())
    AND can_write_cash(auth.uid())
    AND (
      has_cash_permission(auth.uid(), 'caisse_month'::permission_scope)
      OR (
        has_cash_permission(auth.uid(), 'caisse_day'::permission_scope)
        AND day_date = get_business_day(now())
      )
    )
  )
);

-- RLS Policy: UPDATE
-- Same logic as INSERT
CREATE POLICY "Users can update cash reports with proper permissions"
ON public.cash_day_reports
FOR UPDATE
USING (
  is_admin(auth.uid())
  OR (
    establishment_id IN (SELECT get_user_establishment_ids())
    AND can_write_cash(auth.uid())
    AND (
      has_cash_permission(auth.uid(), 'caisse_month'::permission_scope)
      OR (
        has_cash_permission(auth.uid(), 'caisse_day'::permission_scope)
        AND day_date = get_business_day(now())
      )
    )
  )
);

-- RLS Policy: DELETE
-- Only admin can delete cash reports
CREATE POLICY "Only admins can delete cash reports"
ON public.cash_day_reports
FOR DELETE
USING (is_admin(auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_cash_day_reports_updated_at
  BEFORE UPDATE ON public.cash_day_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();