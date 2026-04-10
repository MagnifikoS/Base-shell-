-- PHASE 1.1: Add early_departure_minutes column to badge_events
-- This column will store the SSOT for early departures (same pattern as late_minutes)
-- Only populated for event_type = 'clock_out'
-- NULL = not calculated yet or not applicable
-- 0 = on time or left late
-- > 0 = number of minutes early

ALTER TABLE badge_events
ADD COLUMN early_departure_minutes INTEGER NULL;