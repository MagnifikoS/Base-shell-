-- Enable realtime for stock_events so desktop auto-refreshes on mobile POST
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_events;