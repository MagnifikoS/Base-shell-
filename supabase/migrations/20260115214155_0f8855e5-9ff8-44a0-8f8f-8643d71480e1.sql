-- Migration: effective_time (TIME) -> effective_at (TIMESTAMPTZ)
-- Objectif: Fiabiliser la donnée avec timezone explicite

-- 1) Ajouter la nouvelle colonne effective_at
ALTER TABLE public.badge_events
ADD COLUMN effective_at TIMESTAMPTZ;

-- 2) Backfill: combiner day_date + effective_time en TIMESTAMPTZ UTC
-- Note: Les données existantes sont converties en UTC (timezone serveur)
UPDATE public.badge_events
SET effective_at = (day_date + effective_time)::timestamptz
WHERE effective_at IS NULL;

-- 3) Rendre la colonne NOT NULL maintenant que le backfill est fait
ALTER TABLE public.badge_events
ALTER COLUMN effective_at SET NOT NULL;

-- 4) Supprimer l'ancienne colonne effective_time
ALTER TABLE public.badge_events
DROP COLUMN effective_time;

-- 5) Créer un index pour les requêtes par effective_at
CREATE INDEX IF NOT EXISTS idx_badge_events_effective_at 
ON public.badge_events (user_id, day_date, effective_at);