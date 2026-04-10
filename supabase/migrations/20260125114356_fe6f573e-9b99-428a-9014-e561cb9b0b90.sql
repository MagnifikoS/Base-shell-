-- ÉTAPE 51: Cleanup legacy NULL assignments
-- Migration idempotente et sécurisée (corrigée)

-- ============================================
-- PHASE 2: Migration user_roles
-- ============================================

-- 2a) Insérer les lignes migrées (users avec exactement 1 établissement)
INSERT INTO public.user_roles (user_id, role_id, establishment_id, created_at)
SELECT 
  ur.user_id,
  ur.role_id,
  ue.establishment_id,
  ur.created_at
FROM public.user_roles ur
INNER JOIN (
  -- Users ayant exactement 1 établissement (utiliser MAX cast text puis recast uuid)
  SELECT user_id, (array_agg(establishment_id))[1] as establishment_id
  FROM public.user_establishments
  GROUP BY user_id
  HAVING COUNT(*) = 1
) ue ON ur.user_id = ue.user_id
WHERE ur.establishment_id IS NULL
-- Éviter les doublons (idempotent)
ON CONFLICT (user_id, role_id, establishment_id) DO NOTHING;

-- 2b) Supprimer les lignes legacy qui ont été migrées
DELETE FROM public.user_roles ur
WHERE ur.establishment_id IS NULL
  AND EXISTS (
    -- Vérifier que le user a exactement 1 établissement
    SELECT 1 FROM public.user_establishments ue
    WHERE ue.user_id = ur.user_id
    GROUP BY ue.user_id
    HAVING COUNT(*) = 1
  )
  AND EXISTS (
    -- Vérifier que la ligne migrée existe
    SELECT 1 FROM public.user_roles ur2
    INNER JOIN public.user_establishments ue ON ur2.establishment_id = ue.establishment_id
    WHERE ur2.user_id = ur.user_id 
      AND ur2.role_id = ur.role_id
      AND ue.user_id = ur.user_id
  );

-- ============================================
-- PHASE 3: Migration user_teams
-- ============================================

-- 3a) Insérer les lignes migrées (users avec exactement 1 établissement)
INSERT INTO public.user_teams (user_id, team_id, establishment_id, created_at)
SELECT 
  ut.user_id,
  ut.team_id,
  ue.establishment_id,
  ut.created_at
FROM public.user_teams ut
INNER JOIN (
  -- Users ayant exactement 1 établissement
  SELECT user_id, (array_agg(establishment_id))[1] as establishment_id
  FROM public.user_establishments
  GROUP BY user_id
  HAVING COUNT(*) = 1
) ue ON ut.user_id = ue.user_id
WHERE ut.establishment_id IS NULL
-- Éviter les doublons (idempotent)
ON CONFLICT (user_id, team_id, establishment_id) DO NOTHING;

-- 3b) Supprimer les lignes legacy qui ont été migrées
DELETE FROM public.user_teams ut
WHERE ut.establishment_id IS NULL
  AND EXISTS (
    -- Vérifier que le user a exactement 1 établissement
    SELECT 1 FROM public.user_establishments ue
    WHERE ue.user_id = ut.user_id
    GROUP BY ue.user_id
    HAVING COUNT(*) = 1
  )
  AND EXISTS (
    -- Vérifier que la ligne migrée existe
    SELECT 1 FROM public.user_teams ut2
    INNER JOIN public.user_establishments ue ON ut2.establishment_id = ue.establishment_id
    WHERE ut2.user_id = ut.user_id 
      AND ut2.team_id = ut.team_id
      AND ue.user_id = ut.user_id
  );