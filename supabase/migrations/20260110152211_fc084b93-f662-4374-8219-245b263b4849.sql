-- ============================================================
-- MIGRATION ONE-SHOT : Réinitialiser les test users "legacy"
-- ============================================================
-- Objectif : Aligner les anciens utilisateurs test créés avant
-- le fix pour qu'ils passent par le workflow de validation admin.
--
-- Règle : Pour toute invitation is_test = true avec status 'accepted'
-- et profile 'active', on remet les deux en 'requested'.
-- ============================================================

-- 1) Mettre à jour les profils liés aux invitations test acceptées
UPDATE public.profiles
SET status = 'requested',
    updated_at = now()
WHERE email IN (
    SELECT email 
    FROM public.invitations 
    WHERE is_test = true 
    AND status = 'accepted'
)
AND status = 'active';

-- 2) Mettre à jour les invitations test acceptées
UPDATE public.invitations
SET status = 'requested',
    updated_at = now()
WHERE is_test = true
AND status = 'accepted';