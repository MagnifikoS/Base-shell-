
-- ═══════════════════════════════════════════════════════════════════════════
-- BUG 1: Fix idempotence — unique on (rule_id, alert_key, recipient_user_id)
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop old unique constraint (must use ALTER TABLE, not DROP INDEX)
ALTER TABLE public.notification_events 
  DROP CONSTRAINT IF EXISTS uq_notification_events_alert_recipient;

-- Create new unique constraint including rule_id
CREATE UNIQUE INDEX uq_notification_events_rule_alert_recipient 
  ON public.notification_events (rule_id, alert_key, recipient_user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- BUG 2: Cleanup empty body events — set placeholder text
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.notification_events
SET payload = jsonb_set(
  COALESCE(payload, '{}'::jsonb),
  '{body}',
  '"[Notification]"'::jsonb
)
WHERE payload IS NOT NULL 
  AND (payload->>'body' IS NULL OR payload->>'body' = '');
