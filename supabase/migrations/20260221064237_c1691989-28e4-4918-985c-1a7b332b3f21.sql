
-- ═══════════════════════════════════════════════════════════════
-- BACKFILL: Migrate legacy notification_rules to SSOT config
-- For each rule, populate config.role_{id}.* from global columns
-- if the per-role config is missing or incomplete.
-- After this, the engine and UI read ONLY from config.role_{id}.*
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  r RECORD;
  role_id TEXT;
  role_key TEXT;
  existing_role_config JSONB;
  new_config JSONB;
  needs_update BOOLEAN;
BEGIN
  FOR r IN
    SELECT id, config, min_severity, cooldown_minutes, body_template, title_template, recipient_role_ids
    FROM public.notification_rules
    WHERE category = 'badgeuse'
  LOOP
    new_config := COALESCE(r.config, '{}'::jsonb);
    needs_update := false;

    FOREACH role_id IN ARRAY r.recipient_role_ids
    LOOP
      role_key := 'role_' || role_id;
      existing_role_config := new_config -> role_key;

      -- Only backfill if the role config is missing or has no initialMessageBody
      IF existing_role_config IS NULL 
         OR (existing_role_config ->> 'initialMessageBody') IS NULL 
         OR (existing_role_config ->> 'initialMessageBody') = '' THEN
        
        new_config := jsonb_set(
          new_config,
          ARRAY[role_key],
          COALESCE(existing_role_config, '{}'::jsonb)
            || jsonb_build_object(
              'delayMinutes', COALESCE((existing_role_config ->> 'delayMinutes')::int, r.min_severity, 5),
              'remindersEnabled', COALESCE((existing_role_config ->> 'remindersEnabled')::boolean, r.cooldown_minutes > 0),
              'reminderIntervalMinutes', COALESCE((existing_role_config ->> 'reminderIntervalMinutes')::int, GREATEST(r.cooldown_minutes, 5)),
              'maxReminders', COALESCE((existing_role_config ->> 'maxReminders')::int, 3),
              'initialMessageBody', COALESCE(NULLIF(existing_role_config ->> 'initialMessageBody', ''), r.body_template, ''),
              'titleTemplate', COALESCE(NULLIF(existing_role_config ->> 'titleTemplate', ''), r.title_template, ''),
              'includeEmployeeName', COALESCE((existing_role_config ->> 'includeEmployeeName')::boolean, false),
              'reminderMessageBody', COALESCE(NULLIF(existing_role_config ->> 'reminderMessageBody', ''), ''),
              'finalReminderEnabled', COALESCE((existing_role_config ->> 'finalReminderEnabled')::boolean, false),
              'finalReminderBody', COALESCE(NULLIF(existing_role_config ->> 'finalReminderBody', ''), '')
            ),
          true
        );
        needs_update := true;
      END IF;
    END LOOP;

    IF needs_update THEN
      UPDATE public.notification_rules
      SET config = new_config, updated_at = now()
      WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;
