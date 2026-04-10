-- PHASE 4: Archive + Delete des 24 badges futurs test
-- Créés le 2026-01-26 pour day_date 2026-02-01

-- 1. Créer table backup
CREATE TABLE IF NOT EXISTS public.badge_events_test_purge_20260127 (
  id uuid NOT NULL,
  user_id uuid NOT NULL,
  establishment_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  event_type text NOT NULL,
  day_date date NOT NULL,
  sequence_index integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  effective_at timestamptz NOT NULL,
  device_id text,
  late_minutes integer,
  early_departure_minutes integer,
  created_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  purge_reason text NOT NULL DEFAULT 'FUTURE_BADGE_TEST_DATA'
);

-- 2. Archiver les badges futurs
INSERT INTO public.badge_events_test_purge_20260127 (
  id, user_id, establishment_id, organization_id, event_type, 
  day_date, sequence_index, occurred_at, effective_at, device_id,
  late_minutes, early_departure_minutes, created_at
)
SELECT 
  id, user_id, establishment_id, organization_id, event_type,
  day_date, sequence_index, occurred_at, effective_at, device_id,
  late_minutes, early_departure_minutes, created_at
FROM public.badge_events
WHERE day_date >= '2026-02-01'::date
  AND created_at < '2026-02-01'::timestamptz;

-- 3. Supprimer les badges futurs de la table principale
DELETE FROM public.badge_events
WHERE day_date >= '2026-02-01'::date
  AND created_at < '2026-02-01'::timestamptz;