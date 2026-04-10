
-- ═══════════════════════════════════════════════════════════════════
-- Étape 4: notification_incidents — Shadow V2 incident lifecycle
-- ═══════════════════════════════════════════════════════════════════

-- Create enum for incident status
CREATE TYPE public.incident_status AS ENUM ('OPEN', 'RESOLVED');

-- Create the notification_incidents table
CREATE TABLE public.notification_incidents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  user_id UUID NOT NULL,
  shift_id UUID NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('no_badge', 'missing_clock_out')),
  status public.incident_status NOT NULL DEFAULT 'OPEN',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  last_notified_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Partial unique index: only one OPEN incident per (shift, alert_type, user)
CREATE UNIQUE INDEX uix_incidents_open_per_shift
  ON public.notification_incidents (shift_id, alert_type, user_id)
  WHERE status = 'OPEN';

-- Performance index for resolution queries
CREATE INDEX idx_incidents_open_establishment
  ON public.notification_incidents (establishment_id, status)
  WHERE status = 'OPEN';

-- Performance index for audit queries
CREATE INDEX idx_incidents_user_date
  ON public.notification_incidents (user_id, opened_at DESC);

-- Enable RLS
ALTER TABLE public.notification_incidents ENABLE ROW LEVEL SECURITY;

-- RLS: service role only for writes (edge functions)
-- Read: admins can see their establishment's incidents
CREATE POLICY "Users can view incidents in their establishment"
  ON public.notification_incidents
  FOR SELECT
  USING (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue WHERE ue.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies for regular users — only service role writes
