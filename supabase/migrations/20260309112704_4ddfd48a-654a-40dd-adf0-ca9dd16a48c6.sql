-- Extend both constraints for dish order notifications
ALTER TABLE public.notification_rules DROP CONSTRAINT chk_notification_rules_alert_type;
ALTER TABLE public.notification_rules DROP CONSTRAINT chk_notification_rules_category;

ALTER TABLE public.notification_rules ADD CONSTRAINT chk_notification_rules_category CHECK (
  category = ANY (ARRAY['badgeuse', 'commande', 'commande_plat'])
);

ALTER TABLE public.notification_rules ADD CONSTRAINT chk_notification_rules_alert_type CHECK (
  alert_type = ANY (ARRAY[
    'late', 'no_badge', 'no_badge_arrival', 'no_badge_departure', 'missing_clock_out',
    'commande_recue', 'commande_expediee_complete', 'commande_expediee_partielle',
    'commande_reception_validee_complete', 'commande_reception_validee_partielle',
    'commande_envoyee', 'commande_ouverte',
    'commande_plat_envoyee', 'commande_plat_recue', 'commande_plat_ouverte',
    'commande_plat_expediee', 'commande_plat_reception_validee',
    'commande_plat_litige', 'commande_plat_litige_resolu'
  ])
);

INSERT INTO public.notification_rules (establishment_id, organization_id, category, alert_type, enabled, title_template, body_template, scope, priority)
SELECT 
  e.id, e.organization_id, 'commande_plat', alert.alert_type, true,
  alert.title_template, alert.body_template, alert.scope, 5
FROM public.establishments e
CROSS JOIN (VALUES
  ('commande_plat_envoyee', 'Commande plats envoyée', 'Votre commande de plats a été envoyée', 'management'),
  ('commande_plat_recue', 'Nouvelle commande plats', 'Vous avez reçu une commande de plats', 'establishment'),
  ('commande_plat_ouverte', 'Commande plats consultée', 'Le fournisseur a consulté votre commande de plats', 'management'),
  ('commande_plat_expediee', 'Commande plats expédiée', 'Votre commande de plats a été expédiée', 'management'),
  ('commande_plat_reception_validee', 'Réception plats validée', 'La réception de votre commande de plats a été validée', 'establishment'),
  ('commande_plat_litige', 'Litige plats créé', 'Un litige a été créé sur une commande de plats', 'establishment'),
  ('commande_plat_litige_resolu', 'Litige plats résolu', 'Le litige sur votre commande de plats a été résolu', 'management')
) AS alert(alert_type, title_template, body_template, scope)
ON CONFLICT DO NOTHING;