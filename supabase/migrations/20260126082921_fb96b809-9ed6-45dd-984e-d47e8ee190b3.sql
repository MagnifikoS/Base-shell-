-- Enable realtime for planning_weeks table (validation sync multi-onglets/multi-admin)
ALTER PUBLICATION supabase_realtime ADD TABLE public.planning_weeks;