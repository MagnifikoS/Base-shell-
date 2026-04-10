-- PHASE 1: NETTOYAGE PROD + MONITORING (POST-FIX BADGE)
-- Réversible, idempotent, auditable
-- Aucun trigger, aucun recalcul, aucune modification métier

-- ============================================
-- 1. TABLE D'ARCHIVE (pour rollback et audit)
-- ============================================
CREATE TABLE IF NOT EXISTS public.badge_events_duplicates_archive (
  archived_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  -- Colonnes identiques à badge_events
  id uuid NOT NULL,
  organization_id uuid NOT NULL,
  establishment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  day_date date NOT NULL,
  sequence_index integer NOT NULL,
  device_id text,
  created_at timestamptz NOT NULL,
  effective_at timestamptz NOT NULL,
  late_minutes integer
);

-- Index pour recherche rapide en cas de rollback
CREATE INDEX IF NOT EXISTS idx_badge_duplicates_user_day 
ON public.badge_events_duplicates_archive (user_id, day_date);

-- Commentaire documentation
COMMENT ON TABLE public.badge_events_duplicates_archive IS 
'Archive des badge_events dupliqués supprimés lors du nettoyage BADGE-001. Permet rollback et audit. Aucune RLS, aucune FK.';

-- ============================================
-- 2. VUE MONITORING INTEGRITY CHECK (read-only)
-- ============================================
CREATE OR REPLACE VIEW public.badge_events_integrity_check AS
SELECT
  user_id,
  establishment_id,
  day_date,
  sequence_index,
  event_type,
  COUNT(*) AS cnt
FROM public.badge_events
GROUP BY user_id, establishment_id, day_date, sequence_index, event_type
HAVING COUNT(*) > 1;

COMMENT ON VIEW public.badge_events_integrity_check IS 
'Vue monitoring: détecte les doublons badge_events. Doit retourner 0 ligne en prod saine.';