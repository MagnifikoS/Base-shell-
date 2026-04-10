-- ============================================
-- MIGRATION ONE-SHOT : Nettoyage résidus historiques
-- Objectif : Supprimer tous les résidus (profils, assignations, invitations)
--            pour les utilisateurs non-actifs afin de permettre la recréation
--            d'emails test.
-- ============================================

-- 1) Supprimer les assignations (user_roles, user_teams, user_establishments)
--    pour les profils avec status IN ('requested', 'rejected', 'invited')

DELETE FROM public.user_roles
WHERE user_id IN (
  SELECT user_id FROM public.profiles
  WHERE status IN ('requested', 'rejected', 'invited')
);

DELETE FROM public.user_teams
WHERE user_id IN (
  SELECT user_id FROM public.profiles
  WHERE status IN ('requested', 'rejected', 'invited')
);

DELETE FROM public.user_establishments
WHERE user_id IN (
  SELECT user_id FROM public.profiles
  WHERE status IN ('requested', 'rejected', 'invited')
);

-- 2) Supprimer les invitations liées aux profils non-actifs (par email + org)
--    Cela inclut les status: canceled, rejected, expired, invited, requested
--    SAUF 'accepted' (déjà exclu car le profil serait 'active')

DELETE FROM public.invitations
WHERE status != 'accepted'
  AND email IN (
    SELECT email FROM public.profiles
    WHERE status IN ('requested', 'rejected', 'invited')
  );

-- 3) Supprimer les invitations orphelines (canceled, rejected, expired)
--    qui n'ont pas de profil associé (best-effort cleanup)

DELETE FROM public.invitations
WHERE status IN ('canceled', 'rejected', 'expired')
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.email = invitations.email
      AND p.organization_id = invitations.organization_id
      AND p.status = 'active'
  );

-- 4) Supprimer les profils non-actifs (requested, rejected, invited)
--    ATTENTION : Ne jamais toucher aux profiles.status = 'active'

DELETE FROM public.profiles
WHERE status IN ('requested', 'rejected', 'invited');

-- 5) Cleanup final : Supprimer les assignations orphelines
--    (user_id qui n'existe plus dans profiles)

DELETE FROM public.user_roles
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.user_id = user_roles.user_id
);

DELETE FROM public.user_teams
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.user_id = user_teams.user_id
);

DELETE FROM public.user_establishments
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.user_id = user_establishments.user_id
);