-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE A: Enable realtime for personnel_leaves
-- Consistent with existing pattern (badge_events, planning_shifts, etc.)
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable REPLICA IDENTITY FULL for DELETE event to include establishment_id
ALTER TABLE public.personnel_leaves REPLICA IDENTITY FULL;

-- Add to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.personnel_leaves;