-- Idempotence: prevent duplicate notification events for same incident+recipient+wave
-- First, remove any existing duplicates (keep the earliest)
DELETE FROM public.notification_events
WHERE id NOT IN (
  SELECT DISTINCT ON (incident_id, recipient_user_id, alert_key)
    id
  FROM public.notification_events
  WHERE incident_id IS NOT NULL
  ORDER BY incident_id, recipient_user_id, alert_key, sent_at ASC
)
AND incident_id IS NOT NULL
AND EXISTS (
  SELECT 1 FROM public.notification_events ne2
  WHERE ne2.incident_id = notification_events.incident_id
    AND ne2.recipient_user_id = notification_events.recipient_user_id
    AND ne2.alert_key = notification_events.alert_key
    AND ne2.id != notification_events.id
    AND ne2.sent_at <= notification_events.sent_at
);

-- Add unique constraint for idempotent inserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_events_idempotent
ON public.notification_events (incident_id, recipient_user_id, alert_key)
WHERE incident_id IS NOT NULL;