-- Step 7.1: Add shift_id to badge_events for late → V2 unification
-- Nullable FK: not all badge events have a matched shift (no-shift day, ambiguous, etc.)
ALTER TABLE public.badge_events
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.planning_shifts(id) ON DELETE SET NULL;

-- Index for efficient lookups by shift
CREATE INDEX IF NOT EXISTS idx_badge_events_shift_id ON public.badge_events(shift_id) WHERE shift_id IS NOT NULL;

-- Add match_status for traceability (matched, ambiguous, unmatched)
ALTER TABLE public.badge_events
  ADD COLUMN IF NOT EXISTS shift_match_status TEXT DEFAULT NULL;

COMMENT ON COLUMN public.badge_events.shift_id IS 'FK to the planning_shift this badge event is associated with. Set at badge creation time. NULL if no shift matched.';
COMMENT ON COLUMN public.badge_events.shift_match_status IS 'How the shift was matched: matched, ambiguous, unmatched, or NULL for legacy events.';