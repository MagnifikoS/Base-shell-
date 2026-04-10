-- CORRECTION SÉCURITÉ: Table archive audit-only + Vue SECURITY INVOKER
-- La table archive est intentionnellement sans RLS (usage admin/audit uniquement)
-- On active RLS avec policy admin-only pour satisfaire le linter

-- ============================================
-- 1. RLS sur table archive (admin-only)
-- ============================================
ALTER TABLE public.badge_events_duplicates_archive ENABLE ROW LEVEL SECURITY;

-- Policy: seuls les admins peuvent voir l'archive (audit/rollback)
CREATE POLICY "Admins can view archive for audit"
ON public.badge_events_duplicates_archive
FOR SELECT
USING (public.is_admin(auth.uid()));

-- Policy: aucune insertion/update/delete via API (service_role uniquement)
-- Pas de policy INSERT/UPDATE/DELETE = bloqué par défaut avec RLS activé

-- ============================================
-- 2. Vue avec SECURITY INVOKER (correction linter)
-- ============================================
DROP VIEW IF EXISTS public.badge_events_integrity_check;

CREATE VIEW public.badge_events_integrity_check 
WITH (security_invoker = true) AS
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
'Vue monitoring: détecte les doublons badge_events. SECURITY INVOKER = respecte RLS de badge_events.';