-- Enable realtime for badge_events table (Phase 2.3: Multi-admin sync)
ALTER PUBLICATION supabase_realtime ADD TABLE public.badge_events;