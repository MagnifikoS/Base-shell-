-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: Add unique partial index to prevent duplicate approved absences
-- A user cannot have two approved absences on the same day for the same establishment
-- Cancelled absences do NOT block re-declaration
-- ═══════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS idx_personnel_leaves_unique_approved
ON public.personnel_leaves (establishment_id, user_id, leave_date)
WHERE status = 'approved';