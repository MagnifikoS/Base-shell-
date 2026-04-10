-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1 R-EXTRA: Table planning_rextra_events
-- Module indépendant, supprimable sans impact sur planning_shifts
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.planning_rextra_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  user_id UUID NOT NULL,
  event_date DATE NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Unique par (establishment, user, date) - une seule pose R.Extra par jour
  UNIQUE (establishment_id, user_id, event_date)
);

-- Index pour performances getWeek (fenêtre date)
CREATE INDEX idx_rextra_events_lookup 
ON public.planning_rextra_events (establishment_id, event_date);

CREATE INDEX idx_rextra_events_user_date 
ON public.planning_rextra_events (user_id, event_date);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS: Même pattern RBAC que planning_shifts
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.planning_rextra_events ENABLE ROW LEVEL SECURITY;

-- SELECT: planning read access pour l'établissement
CREATE POLICY "rextra_select_policy" 
ON public.planning_rextra_events 
FOR SELECT 
USING (
  public.has_module_access('planning', 'read', establishment_id)
);

-- INSERT: planning write access pour l'établissement
CREATE POLICY "rextra_insert_policy" 
ON public.planning_rextra_events 
FOR INSERT 
WITH CHECK (
  public.has_module_access('planning', 'write', establishment_id)
);

-- UPDATE: planning write access pour l'établissement
CREATE POLICY "rextra_update_policy" 
ON public.planning_rextra_events 
FOR UPDATE 
USING (
  public.has_module_access('planning', 'write', establishment_id)
);

-- DELETE: planning write access pour l'établissement
CREATE POLICY "rextra_delete_policy" 
ON public.planning_rextra_events 
FOR DELETE 
USING (
  public.has_module_access('planning', 'write', establishment_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Enable Realtime for instant sync
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.planning_rextra_events REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.planning_rextra_events;