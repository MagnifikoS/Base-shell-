
-- ═══════════════════════════════════════════════════════════════════
-- Étape 5: V2 bascule progressive — flag par établissement + incident tracking
-- ═══════════════════════════════════════════════════════════════════

-- 5.1 Per-establishment V2 flag (default false = V1 active)
ALTER TABLE public.establishments
  ADD COLUMN notif_engine_v2 BOOLEAN NOT NULL DEFAULT false;

-- 5.2 Link notification_events to incidents for V2 idempotency
ALTER TABLE public.notification_events
  ADD COLUMN incident_id UUID REFERENCES public.notification_incidents(id);

-- Index for V2 idempotency check: "has this incident been notified to this recipient?"
CREATE INDEX idx_notification_events_incident_recipient
  ON public.notification_events (incident_id, recipient_user_id)
  WHERE incident_id IS NOT NULL;
