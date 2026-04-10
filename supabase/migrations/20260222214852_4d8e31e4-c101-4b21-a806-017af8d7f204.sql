
-- ═══════════════════════════════════════════════════════════════════
-- fn_send_commande_notification: SECURITY DEFINER function
-- Inserts notification_events for commande module
-- SAFE: Does NOT touch badgeuse rules/incidents/CRON
-- Anti-doublon via unique index uq_notification_events_estab_alert_recipient
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_send_commande_notification(
  p_alert_type TEXT,
  p_establishment_id UUID,    -- target establishment (who receives)
  p_order_id UUID,
  p_title TEXT,
  p_body TEXT,
  p_source_establishment_name TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rule_id UUID;
  v_inserted INT := 0;
  v_recipient RECORD;
  v_alert_key TEXT;
BEGIN
  -- 1. Find the notification_rule for this alert_type + establishment
  SELECT id INTO v_rule_id
  FROM notification_rules
  WHERE establishment_id = p_establishment_id
    AND alert_type = p_alert_type
    AND category = 'commande'
  LIMIT 1;

  -- If no rule exists for this establishment, create one on-the-fly
  IF v_rule_id IS NULL THEN
    INSERT INTO notification_rules (
      establishment_id, organization_id, category, alert_type, enabled,
      recipient_role_ids, cooldown_minutes,
      active_start_time, active_end_time,
      title_template, body_template, min_severity, config, priority, scope
    )
    SELECT
      p_establishment_id,
      e.organization_id,
      'commande',
      p_alert_type,
      true,
      '{}'::uuid[],
      0,
      '00:00'::time,
      '23:59'::time,
      p_title,
      p_body,
      0,
      '{}'::jsonb,
      100,
      'establishment'
    FROM establishments e
    WHERE e.id = p_establishment_id
    RETURNING id INTO v_rule_id;
  END IF;

  IF v_rule_id IS NULL THEN
    RETURN 0; -- establishment not found
  END IF;

  -- 2. Find all users at this establishment with commande module access
  -- Uses the existing RBAC tables (user_roles + role_permissions + user_establishments)
  FOR v_recipient IN
    SELECT DISTINCT ue.user_id
    FROM user_establishments ue
    JOIN user_roles ur ON ur.user_id = ue.user_id
      AND ur.establishment_id = p_establishment_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    WHERE ue.establishment_id = p_establishment_id
      AND rp.module_key = 'commande'
      AND rp.access_level IN ('read', 'write', 'full')
      -- Exclude the caller (don't notify yourself)
      AND ue.user_id != auth.uid()
  LOOP
    v_alert_key := p_alert_type || ':' || p_order_id::text || ':' || v_recipient.user_id::text;

    -- Insert with ON CONFLICT DO NOTHING (anti-doublon via unique index)
    INSERT INTO notification_events (
      rule_id,
      establishment_id,
      alert_key,
      alert_type,
      recipient_user_id,
      payload,
      incident_id
    ) VALUES (
      v_rule_id,
      p_establishment_id,
      v_alert_key,
      p_alert_type,
      v_recipient.user_id,
      jsonb_build_object(
        'title', p_title,
        'body', p_body,
        'order_id', p_order_id::text,
        'source_establishment_name', COALESCE(p_source_establishment_name, ''),
        'engine_version', 'commande_v1'
      ),
      NULL  -- no incident (commande never uses incidents)
    )
    ON CONFLICT (establishment_id, alert_key, recipient_user_id) DO NOTHING;

    IF FOUND THEN
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;
