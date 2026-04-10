-- Add commande_facturee to allowed alert_types
ALTER TABLE notification_rules DROP CONSTRAINT chk_notification_rules_alert_type;

ALTER TABLE notification_rules ADD CONSTRAINT chk_notification_rules_alert_type
CHECK (alert_type = ANY (ARRAY[
  'late', 'no_badge', 'no_badge_arrival', 'no_badge_departure', 'missing_clock_out',
  'commande_recue', 'commande_expediee_complete', 'commande_expediee_partielle',
  'commande_reception_validee_complete', 'commande_reception_validee_partielle',
  'commande_envoyee', 'commande_ouverte',
  'commande_litige', 'commande_litige_resolue', 'commande_facturee',
  'commande_plat_envoyee', 'commande_plat_recue', 'commande_plat_ouverte',
  'commande_plat_expediee', 'commande_plat_reception_validee',
  'commande_plat_litige', 'commande_plat_litige_resolu'
]));

-- Insert the rule
INSERT INTO notification_rules (alert_type, category, title_template, body_template, enabled, organization_id)
SELECT 'commande_facturee', 'commande', 'Facture disponible', 'La facture de votre commande est disponible', true, 'f056aae1-acb3-4209-949a-a0b399854061'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE alert_type = 'commande_facturee');