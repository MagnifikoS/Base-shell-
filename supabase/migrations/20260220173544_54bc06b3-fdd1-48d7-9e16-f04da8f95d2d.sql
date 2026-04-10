
-- ═══ 1. Fix idempotence: change unique constraint to business-event level ═══
-- Drop the old rule-based unique constraint
DROP INDEX IF EXISTS uq_notification_events_rule_alert_recipient;

-- Create new business-event idempotence: one notif per event per recipient per establishment
CREATE UNIQUE INDEX uq_notification_events_estab_alert_recipient 
  ON public.notification_events (establishment_id, alert_key, recipient_user_id);

-- ═══ 2. Add priority and scope to notification_rules ═══
ALTER TABLE public.notification_rules 
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100;

ALTER TABLE public.notification_rules 
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'management';

-- ═══ 3. Set scope for existing employee-targeted rules ═══
-- Rules targeting role 00000000-0000-0000-0000-000000000004 (employee) → 'self'
UPDATE public.notification_rules 
SET scope = 'self', priority = 50
WHERE '00000000-0000-0000-0000-000000000004' = ANY(recipient_role_ids);

-- Rules targeting admins/managers → 'management' (default, lower priority = higher)
UPDATE public.notification_rules 
SET priority = 100
WHERE NOT ('00000000-0000-0000-0000-000000000004' = ANY(recipient_role_ids));

-- ═══ 4. Clean up duplicate notification_events from previous bug ═══
-- Keep only the most recent event per (establishment_id, alert_key, recipient_user_id)
DELETE FROM public.notification_events a
USING public.notification_events b
WHERE a.establishment_id = b.establishment_id
  AND a.alert_key = b.alert_key
  AND a.recipient_user_id = b.recipient_user_id
  AND a.sent_at < b.sent_at;
