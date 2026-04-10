
-- ═══════════════════════════════════════════════════════════════
-- NotifEngine V0 — Tables notification_rules + notification_events
-- SSOT = badge_events (lecture seule, zéro logique métier)
-- ═══════════════════════════════════════════════════════════════

-- 1. notification_rules — configuration des règles par établissement
CREATE TABLE public.notification_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'badgeuse',
  alert_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  recipient_role_ids UUID[] NOT NULL DEFAULT '{}',
  cooldown_minutes INTEGER NOT NULL DEFAULT 60,
  active_start_time TIME NOT NULL DEFAULT '06:00',
  active_end_time TIME NOT NULL DEFAULT '23:00',
  title_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  min_severity INTEGER NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour lookup par établissement + catégorie
CREATE INDEX idx_notification_rules_establishment_category
  ON public.notification_rules(establishment_id, category, enabled);

-- 2. notification_events — historique + idempotency
CREATE TABLE public.notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.notification_rules(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  alert_key TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  recipient_user_id UUID NOT NULL,
  payload JSONB,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_events_alert_recipient UNIQUE(alert_key, recipient_user_id)
);

-- Index pour lookup cooldown
CREATE INDEX idx_notification_events_rule_sent
  ON public.notification_events(rule_id, sent_at DESC);

CREATE INDEX idx_notification_events_alert_key
  ON public.notification_events(alert_key);

-- 3. RLS
ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

-- Rules : admins/managers de l'établissement peuvent lire/écrire
CREATE POLICY "Users with module access can read notification_rules"
  ON public.notification_rules FOR SELECT TO authenticated
  USING (public.has_module_access('alertes', 'read', establishment_id));

CREATE POLICY "Users with full access can manage notification_rules"
  ON public.notification_rules FOR ALL TO authenticated
  USING (public.has_module_access('alertes', 'full', establishment_id))
  WITH CHECK (public.has_module_access('alertes', 'full', establishment_id));

-- Events : lecture seule pour les utilisateurs autorisés
CREATE POLICY "Users with module access can read notification_events"
  ON public.notification_events FOR SELECT TO authenticated
  USING (public.has_module_access('alertes', 'read', establishment_id));

-- Service role (edge functions) peut tout faire sur events
CREATE POLICY "Service role can manage notification_events"
  ON public.notification_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role can read notification_rules"
  ON public.notification_rules FOR SELECT TO service_role
  USING (true);

-- 4. Trigger updated_at pour notification_rules
CREATE TRIGGER update_notification_rules_updated_at
  BEFORE UPDATE ON public.notification_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Contrainte alert_type valide
ALTER TABLE public.notification_rules
  ADD CONSTRAINT chk_notification_rules_alert_type
  CHECK (alert_type IN ('late', 'early_departure'));

ALTER TABLE public.notification_rules
  ADD CONSTRAINT chk_notification_rules_category
  CHECK (category IN ('badgeuse'));
