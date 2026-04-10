
-- ═══════════════════════════════════════════════════════════════════
-- Commande Produits Notifications — Schema extension
-- SAFE: Only extends check constraints + adds new rules
-- Does NOT modify any badgeuse rules, incidents, or CRON logic
-- ═══════════════════════════════════════════════════════════════════

-- 1. Extend category constraint to allow 'commande'
ALTER TABLE notification_rules DROP CONSTRAINT chk_notification_rules_category;
ALTER TABLE notification_rules ADD CONSTRAINT chk_notification_rules_category
  CHECK (category IN ('badgeuse', 'commande'));

-- 2. Extend alert_type constraint to allow commande types
-- (alert_type constraint was already extended in previous migration attempt)
-- Re-apply to be safe (idempotent via DROP IF EXISTS pattern)
ALTER TABLE notification_rules DROP CONSTRAINT IF EXISTS chk_notification_rules_alert_type;
ALTER TABLE notification_rules ADD CONSTRAINT chk_notification_rules_alert_type
  CHECK (alert_type = ANY (ARRAY[
    -- Badgeuse types (unchanged)
    'late', 'no_badge', 'no_badge_arrival', 'no_badge_departure', 'missing_clock_out',
    -- Commande Produits types (new)
    'commande_recue', 'commande_expediee_complete', 'commande_expediee_partielle',
    'commande_reception_validee_complete', 'commande_reception_validee_partielle'
  ]));

-- 3. Insert commande notification_rules for all active establishments
INSERT INTO notification_rules (
  establishment_id, organization_id, category, alert_type, enabled,
  recipient_role_ids, cooldown_minutes,
  active_start_time, active_end_time,
  title_template, body_template, min_severity, config, priority, scope
)
SELECT
  e.id,
  e.organization_id,
  'commande',
  t.alert_type,
  true,
  '{}'::uuid[],
  0,
  '00:00'::time,
  '23:59'::time,
  t.title_tpl,
  t.body_tpl,
  0,
  '{}'::jsonb,
  100,
  'establishment'
FROM establishments e
CROSS JOIN (VALUES
  ('commande_recue',                       'Commande recue',                       'Nouvelle commande recue'),
  ('commande_expediee_complete',           'Commande expediee',                    'Commande expediee'),
  ('commande_expediee_partielle',          'Commande expediee partiellement',      'Commande expediee partiellement'),
  ('commande_reception_validee_complete',  'Reception confirmee',                  'Reception complete confirmee'),
  ('commande_reception_validee_partielle', 'Reception partielle signalee',         'Reception partielle signalee')
) AS t(alert_type, title_tpl, body_tpl)
WHERE e.status = 'active'
ON CONFLICT DO NOTHING;
