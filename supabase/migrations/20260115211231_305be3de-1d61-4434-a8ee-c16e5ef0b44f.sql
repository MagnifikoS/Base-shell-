-- =============================================
-- BADGEUSE V1 - Tables principales
-- =============================================

-- 1) Table badge_events (journal des pointages)
CREATE TABLE public.badge_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('clock_in', 'clock_out')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_time TIME NOT NULL,
  day_date DATE NOT NULL,
  sequence_index INTEGER NOT NULL DEFAULT 1 CHECK (sequence_index IN (1, 2)),
  device_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour requêtes fréquentes
CREATE INDEX idx_badge_events_user_day ON public.badge_events(user_id, day_date);
CREATE INDEX idx_badge_events_establishment_day ON public.badge_events(establishment_id, day_date);

-- 2) Table badgeuse_settings (configuration par établissement)
CREATE TABLE public.badgeuse_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  arrival_tolerance_min INTEGER NOT NULL DEFAULT 10,
  departure_tolerance_min INTEGER NOT NULL DEFAULT 20,
  extra_threshold_min INTEGER NOT NULL DEFAULT 20,
  require_selfie BOOLEAN NOT NULL DEFAULT true,
  require_pin BOOLEAN NOT NULL DEFAULT true,
  device_binding_enabled BOOLEAN NOT NULL DEFAULT true,
  max_devices_per_user INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_establishment_settings UNIQUE (establishment_id)
);

-- 3) Table user_devices (binding devices)
CREATE TABLE public.user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_device UNIQUE (user_id, device_id)
);

CREATE INDEX idx_user_devices_user ON public.user_devices(user_id);

-- 4) Table user_badge_pins (PIN utilisateur pour badgeuse)
CREATE TABLE public.user_badge_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================
-- RLS Policies
-- =============================================

-- Enable RLS on all tables
ALTER TABLE public.badge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badgeuse_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badge_pins ENABLE ROW LEVEL SECURITY;

-- badge_events policies
CREATE POLICY "Users can view own badge events"
ON public.badge_events FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Admins can view org badge events"
ON public.badge_events FOR SELECT
USING (
  organization_id = get_user_organization_id() 
  AND is_admin(auth.uid())
);

-- badgeuse_settings policies (read for all org users, write for admins)
CREATE POLICY "Users can view settings for assigned establishments"
ON public.badgeuse_settings FOR SELECT
USING (
  establishment_id IN (SELECT get_user_establishment_ids())
);

CREATE POLICY "Admins can manage settings"
ON public.badgeuse_settings FOR ALL
USING (
  organization_id = get_user_organization_id() 
  AND is_admin(auth.uid())
);

-- user_devices policies
CREATE POLICY "Users can view own devices"
ON public.user_devices FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Admins can view org user devices"
ON public.user_devices FOR SELECT
USING (
  is_admin(auth.uid()) 
  AND user_id IN (
    SELECT p.user_id FROM profiles p 
    WHERE p.organization_id = get_user_organization_id()
  )
);

-- user_badge_pins policies
CREATE POLICY "Users can view own pin existence"
ON public.user_badge_pins FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can update own pin"
ON public.user_badge_pins FOR UPDATE
USING (user_id = auth.uid());

-- =============================================
-- Trigger for updated_at
-- =============================================

CREATE TRIGGER update_badgeuse_settings_updated_at
BEFORE UPDATE ON public.badgeuse_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_badge_pins_updated_at
BEFORE UPDATE ON public.user_badge_pins
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();