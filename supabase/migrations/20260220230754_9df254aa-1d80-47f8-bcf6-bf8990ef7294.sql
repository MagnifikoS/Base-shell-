-- Step 6: Add notify_count to notification_incidents for anti-spam plafond
ALTER TABLE public.notification_incidents
ADD COLUMN notify_count int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.notification_incidents.notify_count IS 'Number of push notifications sent for this incident. Used as anti-spam cap (max_notifies_per_incident).';
