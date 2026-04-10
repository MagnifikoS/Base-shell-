-- PHASE 1 FINAL: Add UNIQUE constraint to prevent future duplicates
-- This is the critical defense-in-depth protection for payroll reliability

ALTER TABLE badge_events
ADD CONSTRAINT badge_events_unique_per_sequence 
UNIQUE (user_id, establishment_id, day_date, sequence_index, event_type);

COMMENT ON CONSTRAINT badge_events_unique_per_sequence ON badge_events IS 
'Critical payroll constraint: prevents duplicate clock_in/clock_out per user/establishment/day/sequence. Added 2026-01-20 post-cleanup.';