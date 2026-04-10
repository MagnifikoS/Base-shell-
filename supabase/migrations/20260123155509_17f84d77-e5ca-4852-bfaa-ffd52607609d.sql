-- FIX 2 (Phase 2.6): Enable Realtime on cash_day_reports for multi-admin sync
ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_day_reports;