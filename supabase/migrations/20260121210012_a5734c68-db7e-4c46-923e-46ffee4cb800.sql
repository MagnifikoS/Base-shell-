-- ============================================
-- PHASE 1.1: Service Day Unique (Établissement)
-- ============================================
-- Ajoute le paramètre service_day_cutoff sur establishments
-- Crée les fonctions SQL qui seront la SOURCE UNIQUE de vérité

-- 1. Add service_day_cutoff column to establishments (default 03:00)
ALTER TABLE public.establishments
ADD COLUMN service_day_cutoff time NOT NULL DEFAULT '03:00';

-- 2. Create the SINGLE SOURCE OF TRUTH function: get_service_day
-- This replaces all hardcoded 03:00 logic across the codebase
CREATE OR REPLACE FUNCTION public.get_service_day(
  _establishment_id uuid,
  _ts timestamptz DEFAULT now()
)
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN (
      -- Current Paris time in minutes since midnight
      EXTRACT(HOUR FROM (_ts AT TIME ZONE 'Europe/Paris')) * 60
      + EXTRACT(MINUTE FROM (_ts AT TIME ZONE 'Europe/Paris'))
    ) <
    (
      -- Cutoff time in minutes since midnight
      EXTRACT(HOUR FROM e.service_day_cutoff) * 60
      + EXTRACT(MINUTE FROM e.service_day_cutoff)
    )
    THEN ((_ts AT TIME ZONE 'Europe/Paris') - INTERVAL '1 day')::date
    ELSE (_ts AT TIME ZONE 'Europe/Paris')::date
  END
  FROM public.establishments e
  WHERE e.id = _establishment_id;
$$;

-- 3. Convenience wrapper for "now"
CREATE OR REPLACE FUNCTION public.get_service_day_now(_establishment_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT public.get_service_day(_establishment_id, now());
$$;

-- 4. Update cash_day_reports RLS policies to use establishment-aware service day
-- The existing policies use get_business_day(now()) which is hardcoded to 03:00
-- We need to replace this with get_service_day(establishment_id, now())

-- DROP the old INSERT policy and recreate it
DROP POLICY IF EXISTS "Users can insert cash reports with proper permissions" ON public.cash_day_reports;

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
        AND day_date = get_service_day(establishment_id, now())
      )
    )
  )
);

-- DROP the old UPDATE policy and recreate it
DROP POLICY IF EXISTS "Users can update cash reports with proper permissions" ON public.cash_day_reports;

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
        AND day_date = get_service_day(establishment_id, now())
      )
    )
  )
)
WITH CHECK (
  is_admin(auth.uid())
  OR (
    establishment_id IN (SELECT get_user_establishment_ids())
    AND can_write_cash(auth.uid())
    AND (
      has_cash_permission(auth.uid(), 'caisse_month'::permission_scope)
      OR (
        has_cash_permission(auth.uid(), 'caisse_day'::permission_scope)
        AND day_date = get_service_day(establishment_id, now())
      )
    )
  )
);

-- Add documentation comment
COMMENT ON COLUMN public.establishments.service_day_cutoff IS 
'Heure de fin de journée de service (ex: 03:00). Tout événement avant cette heure appartient à la veille.';