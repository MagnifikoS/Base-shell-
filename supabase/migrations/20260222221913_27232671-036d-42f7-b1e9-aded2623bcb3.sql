
-- ═══════════════════════════════════════════════════════════════════
-- Split alertes into "Notifications Badgeuse" + "Notifications Commande"
-- SAFE: Does NOT touch badgeuse engine / CRON / incidents
-- ═══════════════════════════════════════════════════════════════════

-- 1. Rename alertes display name
UPDATE modules SET name = 'Notifications Badgeuse' WHERE key = 'alertes';

-- 2. Add notif_commande module
INSERT INTO modules (key, name, display_order)
VALUES ('notif_commande', 'Notifications Commande', 16)
ON CONFLICT (key) DO NOTHING;

-- 3. Create default role_permissions for notif_commande based on existing alertes permissions
-- Mirror the same access_level but default scope to 'establishment' for commande
INSERT INTO role_permissions (role_id, module_key, access_level, scope)
SELECT rp.role_id, 'notif_commande', 
  CASE 
    WHEN rp.access_level = 'none' THEN 'none'::access_level
    ELSE rp.access_level
  END,
  CASE 
    WHEN rp.access_level = 'none' THEN 'self'::permission_scope
    ELSE 'establishment'::permission_scope  -- commande notifs default to establishment-wide
  END
FROM role_permissions rp
WHERE rp.module_key = 'alertes'
ON CONFLICT (role_id, module_key) DO NOTHING;

-- 4. Update fn_send_commande_notification to filter by notif_commande scope
CREATE OR REPLACE FUNCTION public.fn_send_commande_notification(
  p_alert_type TEXT,
  p_order_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_org UUID;
  v_order RECORD;
  v_source_name TEXT;
  v_dest_name TEXT;
  v_target_establishment_id UUID;
  v_rule_id UUID;
  v_order_num TEXT;
  v_title TEXT;
  v_body TEXT;
  v_inserted INT := 0;
  v_recipient RECORD;
  v_alert_key TEXT;
  v_valid_status TEXT[];
BEGIN
  -- ═══ A. Auth ═══
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT e.organization_id INTO v_caller_org
  FROM user_establishments ue
  JOIN establishments e ON e.id = ue.establishment_id
  WHERE ue.user_id = v_caller_id
  LIMIT 1;

  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'NO_ORGANIZATION';
  END IF;

  -- ═══ B. Fetch order + cross-org validation ═══
  SELECT po.id, po.organization_id, po.status,
         po.source_establishment_id, po.destination_establishment_id,
         src.name AS src_name, src.organization_id AS src_org,
         dst.name AS dst_name, dst.organization_id AS dst_org
  INTO v_order
  FROM product_orders po
  JOIN establishments src ON src.id = po.source_establishment_id
  JOIN establishments dst ON dst.id = po.destination_establishment_id
  WHERE po.id = p_order_id;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF v_order.organization_id != v_caller_org THEN
    RAISE EXCEPTION 'CROSS_ORG_FORBIDDEN';
  END IF;
  IF v_order.src_org != v_order.dst_org THEN
    RAISE EXCEPTION 'CROSS_ORG_ORDER_INVALID';
  END IF;

  v_source_name := v_order.src_name;
  v_dest_name := v_order.dst_name;
  v_order_num := UPPER(LEFT(v_order.id::text, 6));

  -- ═══ C. Status consistency ═══
  v_valid_status := CASE p_alert_type
    WHEN 'commande_recue' THEN ARRAY['sent']
    WHEN 'commande_expediee_complete' THEN ARRAY['shipped', 'preparing', 'prepared']
    WHEN 'commande_expediee_partielle' THEN ARRAY['shipped', 'preparing', 'prepared']
    WHEN 'commande_reception_validee_complete' THEN ARRAY['received', 'closed']
    WHEN 'commande_reception_validee_partielle' THEN ARRAY['received', 'closed']
    ELSE NULL
  END;

  IF v_valid_status IS NULL THEN
    RAISE EXCEPTION 'INVALID_ALERT_TYPE: %', p_alert_type;
  END IF;
  IF NOT (v_order.status = ANY(v_valid_status)) THEN
    RAISE EXCEPTION 'STATUS_MISMATCH: order "%" status "%" vs alert "%"', p_order_id, v_order.status, p_alert_type;
  END IF;

  -- ═══ D. Generate title + body server-side ═══
  IF p_alert_type = 'commande_recue' THEN
    v_target_establishment_id := v_order.destination_establishment_id;
    v_title := '📦 Commande #' || v_order_num || ' reçue';
    v_body := v_source_name || ' a passé une nouvelle commande';
  ELSIF p_alert_type = 'commande_expediee_complete' THEN
    v_target_establishment_id := v_order.source_establishment_id;
    v_title := '🚚 Commande #' || v_order_num || ' expédiée';
    v_body := v_dest_name || ' a expédié la commande #' || v_order_num || '.';
  ELSIF p_alert_type = 'commande_expediee_partielle' THEN
    v_target_establishment_id := v_order.source_establishment_id;
    v_title := '⚠️ Commande #' || v_order_num || ' expédiée partiellement';
    v_body := v_dest_name || ' a expédié la commande #' || v_order_num || '. Certains articles sont manquants ou en quantité réduite.';
  ELSIF p_alert_type = 'commande_reception_validee_complete' THEN
    v_target_establishment_id := v_order.destination_establishment_id;
    v_title := '✅ Réception confirmée — Commande #' || v_order_num;
    v_body := v_source_name || ' a confirmé la réception complète de la commande #' || v_order_num || '.';
  ELSIF p_alert_type = 'commande_reception_validee_partielle' THEN
    v_target_establishment_id := v_order.destination_establishment_id;
    v_title := '⚠️ Réception partielle signalée — Commande #' || v_order_num;
    v_body := v_source_name || ' a signalé une réception partielle de la commande #' || v_order_num || ' (écarts sur certains articles).';
  END IF;

  -- ═══ E. Find org-level rule ═══
  SELECT id INTO v_rule_id
  FROM notification_rules
  WHERE organization_id = v_order.organization_id
    AND alert_type = p_alert_type
    AND category = 'commande'
    AND establishment_id IS NULL
  LIMIT 1;

  IF v_rule_id IS NULL THEN
    INSERT INTO notification_rules (
      establishment_id, organization_id, category, alert_type, enabled,
      recipient_role_ids, cooldown_minutes,
      active_start_time, active_end_time,
      title_template, body_template, min_severity, config, priority, scope
    ) VALUES (
      NULL::uuid, v_order.organization_id, 'commande', p_alert_type, true,
      '{}'::uuid[], 0, '00:00'::time, '23:59'::time,
      '', '', 0, '{}'::jsonb, 100, 'establishment'
    ) RETURNING id INTO v_rule_id;
  END IF;

  -- ═══ F. Find recipients: commande access + notif_commande scope ═══
  FOR v_recipient IN
    SELECT DISTINCT ue.user_id
    FROM user_establishments ue
    JOIN user_roles ur ON ur.user_id = ue.user_id
      AND ur.establishment_id = v_target_establishment_id
    JOIN role_permissions rp_commande ON rp_commande.role_id = ur.role_id
      AND rp_commande.module_key = 'commande'
      AND rp_commande.access_level IN ('read', 'write', 'full')
    -- notif_commande scope filter: only users whose scope includes this notification
    JOIN role_permissions rp_notif ON rp_notif.role_id = ur.role_id
      AND rp_notif.module_key = 'notif_commande'
      AND rp_notif.access_level IN ('read', 'write', 'full')
    WHERE ue.establishment_id = v_target_establishment_id
      AND ue.user_id != v_caller_id
  LOOP
    v_alert_key := p_alert_type || ':' || p_order_id::text || ':' || v_recipient.user_id::text;

    INSERT INTO notification_events (
      rule_id, establishment_id, alert_key, alert_type,
      recipient_user_id, payload, incident_id
    ) VALUES (
      v_rule_id, v_target_establishment_id, v_alert_key, p_alert_type,
      v_recipient.user_id,
      jsonb_build_object(
        'title', v_title, 'body', v_body,
        'order_id', p_order_id::text,
        'source_establishment_name', v_source_name,
        'destination_establishment_name', v_dest_name,
        'engine_version', 'commande_v2'
      ),
      NULL
    )
    ON CONFLICT (establishment_id, alert_key, recipient_user_id) DO NOTHING;

    IF FOUND THEN
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;
