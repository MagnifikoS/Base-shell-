
-- ═══════════════════════════════════════════════════════════════════════════
-- MODULE COMMANDES V0 — Fix: add new alert_types to constraint + insert rules
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 1: Extend the check constraint to include new alert types
ALTER TABLE public.notification_rules DROP CONSTRAINT chk_notification_rules_alert_type;

ALTER TABLE public.notification_rules ADD CONSTRAINT chk_notification_rules_alert_type
  CHECK (alert_type = ANY (ARRAY[
    'late', 'no_badge', 'no_badge_arrival', 'no_badge_departure', 'missing_clock_out',
    'commande_recue', 'commande_expediee_complete', 'commande_expediee_partielle',
    'commande_reception_validee_complete', 'commande_reception_validee_partielle',
    'commande_envoyee', 'commande_ouverte'
  ]));

-- Step 2: Insert new notification rules (commande_envoyee + commande_ouverte)
-- commande_recue already exists, we reuse it for "nouvelle commande reçue"
INSERT INTO public.notification_rules (
  establishment_id, organization_id, category, alert_type, enabled,
  title_template, body_template, cooldown_minutes, scope
)
SELECT
  NULL,
  (SELECT organization_id FROM establishments LIMIT 1),
  'commande',
  v.alert_type,
  true,
  v.title_tpl,
  v.body_tpl,
  0,
  'management'
FROM (VALUES
  ('commande_envoyee', 'Commande envoyée', 'Votre commande a été envoyée au fournisseur'),
  ('commande_ouverte', 'Commande consultée', 'Le fournisseur a consulté votre commande')
) AS v(alert_type, title_tpl, body_tpl)
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_rules nr WHERE nr.alert_type = v.alert_type
);

-- Update existing commande_recue rule templates if empty
UPDATE public.notification_rules
SET title_template = 'Nouvelle commande reçue',
    body_template = 'Vous avez reçu une nouvelle commande'
WHERE alert_type = 'commande_recue'
AND title_template = '';
