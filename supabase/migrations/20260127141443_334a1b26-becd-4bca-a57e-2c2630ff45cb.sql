-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2.1: SSOT GUARD - early_departure_minutes constraint
-- Ensures:
--   1. early_departure_minutes is ONLY set for clock_out events
--   2. Value must be >= 0 when set
--   3. Must be NULL for non-clock_out events
-- ═══════════════════════════════════════════════════════════════════════════

-- Add CHECK constraint for early_departure_minutes SSOT integrity
ALTER TABLE public.badge_events
ADD CONSTRAINT chk_early_departure_clock_out_only
CHECK (
  -- If event_type = 'clock_out': early_departure_minutes can be NULL or >= 0
  -- If event_type != 'clock_out': early_departure_minutes MUST be NULL
  (event_type = 'clock_out' AND (early_departure_minutes IS NULL OR early_departure_minutes >= 0))
  OR
  (event_type != 'clock_out' AND early_departure_minutes IS NULL)
);

-- Add comment for documentation
COMMENT ON COLUMN public.badge_events.early_departure_minutes IS 
'SSOT: Early departure minutes, computed and stored by Edge Function on clock_out only. 
DO NOT recalculate on frontend. Source: badge-events Edge Function checkEarlyDeparture().';