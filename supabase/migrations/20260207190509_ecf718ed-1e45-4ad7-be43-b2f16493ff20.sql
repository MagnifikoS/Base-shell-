-- ═══════════════════════════════════════════════════════════════════════════
-- THE BRAIN — Tables de fondation v0
-- Journal d'apprentissage observable (append-only)
-- ═══════════════════════════════════════════════════════════════════════════

-- Table 1: brain_events (journal brut append-only)
CREATE TABLE public.brain_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  action TEXT NOT NULL,
  context JSONB DEFAULT '{}'::jsonb,
  actor_user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index pour requêtes fréquentes
CREATE INDEX idx_brain_events_establishment ON public.brain_events(establishment_id);
CREATE INDEX idx_brain_events_subject ON public.brain_events(subject);
CREATE INDEX idx_brain_events_action ON public.brain_events(action);
CREATE INDEX idx_brain_events_created_at ON public.brain_events(created_at DESC);
CREATE INDEX idx_brain_events_context ON public.brain_events USING GIN(context);

-- RLS
ALTER TABLE public.brain_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view brain_events for their establishments"
ON public.brain_events FOR SELECT
USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "Users can insert brain_events for their establishments"
ON public.brain_events FOR INSERT
WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- NOTE: Pas de UPDATE/DELETE policy → append-only enforced via RLS

-- Table 2: brain_rules (connaissance structurée)
CREATE TABLE public.brain_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  context_key TEXT NOT NULL,
  value JSONB DEFAULT '{}'::jsonb,
  confirmations_count INTEGER NOT NULL DEFAULT 0,
  corrections_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index pour requêtes fréquentes
CREATE INDEX idx_brain_rules_establishment ON public.brain_rules(establishment_id);
CREATE INDEX idx_brain_rules_subject ON public.brain_rules(subject);
CREATE INDEX idx_brain_rules_context_key ON public.brain_rules(context_key);
CREATE INDEX idx_brain_rules_enabled ON public.brain_rules(enabled);

-- Contrainte unique pour éviter les doublons
ALTER TABLE public.brain_rules 
ADD CONSTRAINT brain_rules_unique_context 
UNIQUE (establishment_id, subject, context_key);

-- RLS
ALTER TABLE public.brain_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view brain_rules for their establishments"
ON public.brain_rules FOR SELECT
USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "Users can insert brain_rules for their establishments"
ON public.brain_rules FOR INSERT
WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "Users can update brain_rules for their establishments"
ON public.brain_rules FOR UPDATE
USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- Trigger pour updated_at
CREATE TRIGGER update_brain_rules_updated_at
BEFORE UPDATE ON public.brain_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();