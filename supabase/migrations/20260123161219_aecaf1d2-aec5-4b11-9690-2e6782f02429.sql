-- Phase 2.7: Enable realtime for planning_shifts (cross-tab/cross-device sync)
ALTER PUBLICATION supabase_realtime ADD TABLE public.planning_shifts;