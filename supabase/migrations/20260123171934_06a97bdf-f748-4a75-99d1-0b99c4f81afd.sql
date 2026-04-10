-- PHASE 2.8 bis: Enable REPLICA IDENTITY FULL for realtime DELETE sync
-- This ensures old row data is available in realtime payloads when using filters

-- badge_events: already FULL per memory, but idempotent
ALTER TABLE public.badge_events REPLICA IDENTITY FULL;

-- planning_shifts: REQUIRED for DELETE with establishment_id filter
ALTER TABLE public.planning_shifts REPLICA IDENTITY FULL;

-- cash_day_reports: REQUIRED for DELETE with establishment_id filter
ALTER TABLE public.cash_day_reports REPLICA IDENTITY FULL;