-- ============================================
-- TABLE 1: planning_shifts (source unique des shifts)
-- ============================================
CREATE TABLE public.planning_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  shift_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  net_minutes integer NOT NULL DEFAULT 0,
  break_minutes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes pour requêtes planning
CREATE INDEX idx_planning_shifts_establishment_date ON public.planning_shifts(establishment_id, shift_date);
CREATE INDEX idx_planning_shifts_user_date ON public.planning_shifts(user_id, shift_date);

-- Enable RLS
ALTER TABLE public.planning_shifts ENABLE ROW LEVEL SECURITY;

-- RLS: Admin peut voir tous les shifts de l'org
CREATE POLICY "Admins can view org shifts"
ON public.planning_shifts
FOR SELECT
USING (
  organization_id = get_user_organization_id()
  AND is_admin(auth.uid())
);

-- RLS: Salarié peut voir uniquement ses propres shifts (préparation mobile)
CREATE POLICY "Users can view own shifts"
ON public.planning_shifts
FOR SELECT
USING (user_id = auth.uid());

-- Trigger updated_at
CREATE TRIGGER update_planning_shifts_updated_at
BEFORE UPDATE ON public.planning_shifts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- TABLE 2: planning_weeks (statut validation)
-- ============================================
CREATE TABLE public.planning_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  week_validated boolean NOT NULL DEFAULT false,
  validated_days jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(establishment_id, week_start)
);

-- Index pour requêtes par établissement/semaine
CREATE INDEX idx_planning_weeks_establishment_week ON public.planning_weeks(establishment_id, week_start);

-- Enable RLS
ALTER TABLE public.planning_weeks ENABLE ROW LEVEL SECURITY;

-- RLS: Admin peut voir toutes les semaines de l'org
CREATE POLICY "Admins can view org planning weeks"
ON public.planning_weeks
FOR SELECT
USING (
  organization_id = get_user_organization_id()
  AND is_admin(auth.uid())
);

-- RLS: Salarié peut voir les semaines de ses établissements
CREATE POLICY "Users can view planning weeks for assigned establishments"
ON public.planning_weeks
FOR SELECT
USING (
  establishment_id IN (SELECT get_user_establishment_ids())
);

-- Trigger updated_at
CREATE TRIGGER update_planning_weeks_updated_at
BEFORE UPDATE ON public.planning_weeks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();