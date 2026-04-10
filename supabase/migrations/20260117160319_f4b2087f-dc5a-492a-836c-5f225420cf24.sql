-- V3.4.x: Add extra time bounds columns for "de...à..." display
-- Rollback: ALTER TABLE public.extra_events DROP COLUMN extra_start_at, DROP COLUMN extra_end_at;

ALTER TABLE public.extra_events
  ADD COLUMN extra_start_at timestamptz,
  ADD COLUMN extra_end_at timestamptz;

-- Note: Nullable for backward compat with existing extras (UI shows "—" for null)