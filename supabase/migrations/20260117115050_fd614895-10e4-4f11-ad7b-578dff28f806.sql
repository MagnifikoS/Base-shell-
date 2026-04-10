-- V3.1 Migration: Paie-ready foundations
-- Rollback: DROP TABLE extra_events; ALTER TABLE badge_events DROP COLUMN late_minutes;

-- 1) Add late_minutes to badge_events (for clock_in events)
ALTER TABLE public.badge_events 
ADD COLUMN late_minutes integer NULL;

-- 2) Create extra_events table for admin workflow
CREATE TABLE public.extra_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_event_id uuid NOT NULL UNIQUE REFERENCES public.badge_events(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  establishment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  day_date date NOT NULL,
  extra_minutes integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  validated_by uuid NULL,
  validated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3) Indexes for extra_events
CREATE INDEX idx_extra_events_establishment_day ON public.extra_events(establishment_id, day_date);
CREATE INDEX idx_extra_events_user_day ON public.extra_events(user_id, day_date);
CREATE INDEX idx_extra_events_status_day ON public.extra_events(status, day_date);

-- 4) Enable RLS (policies will be added in V3.2/V3.3)
ALTER TABLE public.extra_events ENABLE ROW LEVEL SECURITY;

-- 5) Add composite index on badge_events if not exists (for paie queries)
CREATE INDEX IF NOT EXISTS idx_badge_events_establishment_user_day 
ON public.badge_events(establishment_id, user_id, day_date);