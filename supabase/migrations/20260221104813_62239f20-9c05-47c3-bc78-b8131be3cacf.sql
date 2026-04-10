
-- ═══ Migration: Split no_badge → no_badge_arrival / no_badge_departure ═══
-- ═══ + Add rule_id to notification_incidents ═══

-- 0a. Drop CHECK on notification_rules
ALTER TABLE public.notification_rules
  DROP CONSTRAINT IF EXISTS chk_notification_rules_alert_type;

ALTER TABLE public.notification_rules
  ADD CONSTRAINT chk_notification_rules_alert_type
  CHECK (alert_type = ANY (ARRAY['late','no_badge','no_badge_arrival','no_badge_departure','missing_clock_out']));

-- 0b. Drop CHECK on notification_incidents  
ALTER TABLE public.notification_incidents
  DROP CONSTRAINT IF EXISTS notification_incidents_alert_type_check;

ALTER TABLE public.notification_incidents
  ADD CONSTRAINT notification_incidents_alert_type_check
  CHECK (alert_type = ANY (ARRAY['no_badge','no_badge_arrival','no_badge_departure','missing_clock_out','late']));

-- 1. Add rule_id column
ALTER TABLE public.notification_incidents
  ADD COLUMN IF NOT EXISTS rule_id UUID REFERENCES public.notification_rules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notification_incidents_rule_id
  ON public.notification_incidents(rule_id);

-- 2. Migrate rules: no_badge → arrival or departure based on config
UPDATE public.notification_rules
SET alert_type = CASE
  WHEN (config->>'noBadgeSubType') = 'departure' THEN 'no_badge_departure'
  ELSE 'no_badge_arrival'
END
WHERE alert_type = 'no_badge';

-- 3. Duplicate 'both' rules as departure copies
INSERT INTO public.notification_rules (
  establishment_id, organization_id, alert_type, category, enabled,
  min_severity, cooldown_minutes, recipient_role_ids, title_template,
  body_template, active_start_time, active_end_time, config, scope, priority
)
SELECT
  establishment_id, organization_id, 'no_badge_departure', category, enabled,
  min_severity, cooldown_minutes, recipient_role_ids, title_template,
  body_template, active_start_time, active_end_time,
  jsonb_set(config::jsonb, '{noBadgeSubType}', '"departure"')::json,
  scope, priority
FROM public.notification_rules
WHERE alert_type = 'no_badge_arrival'
  AND (config->>'noBadgeSubType') = 'both';

-- Update original 'both' to arrival-only
UPDATE public.notification_rules
SET config = jsonb_set(config::jsonb, '{noBadgeSubType}', '"arrival"')::json
WHERE alert_type = 'no_badge_arrival'
  AND (config->>'noBadgeSubType') = 'both';

-- 4. Migrate incidents and events
UPDATE public.notification_incidents
SET alert_type = 'no_badge_arrival'
WHERE alert_type = 'no_badge';

UPDATE public.notification_events
SET alert_type = 'no_badge_arrival'
WHERE alert_type = 'no_badge';
