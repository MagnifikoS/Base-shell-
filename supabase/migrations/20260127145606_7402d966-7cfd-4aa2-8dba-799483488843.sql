-- Sécuriser la table d'archive avec RLS (accès admin uniquement)
ALTER TABLE public.badge_events_test_purge_20260127 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view purge archive"
ON public.badge_events_test_purge_20260127
FOR SELECT
USING (is_admin(auth.uid()));