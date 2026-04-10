-- Enable REPLICA IDENTITY FULL for personnel_leave_requests
-- This ensures UPDATE events include the establishment_id for realtime filtering
ALTER TABLE public.personnel_leave_requests REPLICA IDENTITY FULL;