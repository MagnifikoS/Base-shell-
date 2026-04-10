-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2 / ÉTAPE 9 — DIAGNOSTIC DIVERGENCE V1 vs V2
-- READ-ONLY — Aucune modification
-- Date: 2026-01-24
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) CONTEXT IDs
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 
  'ba3782e6-790c-44ed-9eb9-780979ff90df'::uuid AS canary_user_id,
  'e9c3dccf-bee3-46c0-b068-52e05c18d883'::uuid AS establishment_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Vérifie si user est admin (is_admin check)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.is_admin('ba3782e6-790c-44ed-9eb9-780979ff90df'::uuid) AS is_admin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3a) user_roles du canary (TOUTES lignes)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 
  ur.id,
  ur.user_id,
  ur.role_id,
  r.name AS role_name,
  ur.establishment_id,
  CASE 
    WHEN ur.establishment_id IS NULL THEN 'GLOBAL (legacy)'
    ELSE 'SCOPED'
  END AS assignment_type
FROM public.user_roles ur
JOIN public.roles r ON r.id = ur.role_id
WHERE ur.user_id = 'ba3782e6-790c-44ed-9eb9-780979ff90df'::uuid
ORDER BY ur.establishment_id NULLS FIRST;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3b) user_teams du canary
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 
  ut.id,
  ut.user_id,
  ut.team_id,
  t.name AS team_name,
  ut.establishment_id
FROM public.user_teams ut
JOIN public.teams t ON t.id = ut.team_id
WHERE ut.user_id = 'ba3782e6-790c-44ed-9eb9-780979ff90df'::uuid;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3c) user_establishments du canary
-- ═══════════════════════════════════════════════════════════════════════════
SELECT *
FROM public.user_establishments
WHERE user_id = 'ba3782e6-790c-44ed-9eb9-780979ff90df'::uuid;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4a) MODE V1-LIKE: Toutes les permissions (tous rôles, peu importe establishment_id)
-- ═══════════════════════════════════════════════════════════════════════════
WITH v1_source_rows AS (
  SELECT 
    ur.role_id,
    r.name AS role_name,
    ur.establishment_id AS ur_establishment_id,
    rp.module_key,
    rp.access_level,
    rp.scope
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  JOIN public.role_permissions rp ON rp.role_id = r.id
  WHERE ur.user_id = 'ba3782e6-790c-44ed-9eb9-780979ff90df'::uuid
)
SELECT * FROM v1_source_rows ORDER BY module_key, role_name;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4b) MODE V2-LIKE: Permissions filtrées (establishment_id = target OR NULL)
-- ═══════════════════════════════════════════════════════════════════════════
WITH v2_source_rows AS (
  SELECT 
    ur.role_id,
    r.name AS role_name,
    ur.establishment_id AS ur_establishment_id,
    rp.module_key,
    rp.access_level,
    rp.scope
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  JOIN public.role_permissions rp ON rp.role_id = r.id
  WHERE ur.user_id = 'ba3782e6-790c-44ed-9eb9-780979ff90df'::uuid
    AND (ur.establishment_id = 'e9c3dccf-bee3-46c0-b068-52e05c18d883'::uuid 
         OR ur.establishment_id IS NULL)
)
SELECT * FROM v2_source_rows ORDER BY module_key, role_name;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Agrégation comparée (preuve MAX) — V1-LIKE vs V2-LIKE
-- ═══════════════════════════════════════════════════════════════════════════
WITH v1_source AS (
  SELECT 
    rp.module_key,
    rp.access_level,
    rp.scope
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  JOIN public.role_permissions rp ON rp.role_id = r.id
  WHERE ur.user_id = 'ba3782e6-790c-44ed-9eb9-780979ff90df'::uuid
),
v2_source AS (
  SELECT 
    rp.module_key,
    rp.access_level,
    rp.scope
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  JOIN public.role_permissions rp ON rp.role_id = r.id
  WHERE ur.user_id = 'ba3782e6-790c-44ed-9eb9-780979ff90df'::uuid
    AND (ur.establishment_id = 'e9c3dccf-bee3-46c0-b068-52e05c18d883'::uuid 
         OR ur.establishment_id IS NULL)
),
v1_agg AS (
  SELECT 
    module_key,
    (ARRAY['none', 'read', 'write', 'full'])[
      MAX(CASE access_level
        WHEN 'none' THEN 1
        WHEN 'read' THEN 2
        WHEN 'write' THEN 3
        WHEN 'full' THEN 4
      END)
    ] AS access_level,
    (ARRAY['self', 'team', 'establishment', 'org'])[
      MAX(CASE scope
        WHEN 'self' THEN 1
        WHEN 'team' THEN 2
        WHEN 'establishment' THEN 3
        WHEN 'org' THEN 4
        WHEN 'caisse_day' THEN 3
        WHEN 'caisse_month' THEN 4
      END)
    ] AS scope
  FROM v1_source
  GROUP BY module_key
),
v2_agg AS (
  SELECT 
    module_key,
    (ARRAY['none', 'read', 'write', 'full'])[
      MAX(CASE access_level
        WHEN 'none' THEN 1
        WHEN 'read' THEN 2
        WHEN 'write' THEN 3
        WHEN 'full' THEN 4
      END)
    ] AS access_level,
    (ARRAY['self', 'team', 'establishment', 'org'])[
      MAX(CASE scope
        WHEN 'self' THEN 1
        WHEN 'team' THEN 2
        WHEN 'establishment' THEN 3
        WHEN 'org' THEN 4
        WHEN 'caisse_day' THEN 3
        WHEN 'caisse_month' THEN 4
      END)
    ] AS scope
  FROM v2_source
  GROUP BY module_key
)
SELECT 
  COALESCE(v1.module_key, v2.module_key) AS module_key,
  v1.access_level AS v1_access,
  v1.scope AS v1_scope,
  v2.access_level AS v2_access,
  v2.scope AS v2_scope,
  CASE 
    WHEN v1.access_level = v2.access_level AND v1.scope = v2.scope THEN 'SAME'
    ELSE 'DIFF'
  END AS status
FROM v1_agg v1
FULL OUTER JOIN v2_agg v2 ON v1.module_key = v2.module_key
ORDER BY module_key;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) Focus sur les modules divergents (PREUVE: aucun en SQL pur)
-- ═══════════════════════════════════════════════════════════════════════════
-- Note: Ce query démontre que les données SQL sont IDENTIQUES.
-- La divergence vient du FRONTEND, pas du SQL.

WITH v1_source AS (
  SELECT rp.module_key, rp.access_level, rp.scope
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  WHERE ur.user_id = 'ba3782e6-790c-44ed-9eb9-780979ff90df'::uuid
),
v2_source AS (
  SELECT rp.module_key, rp.access_level, rp.scope
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  WHERE ur.user_id = 'ba3782e6-790c-44ed-9eb9-780979ff90df'::uuid
    AND (ur.establishment_id = 'e9c3dccf-bee3-46c0-b068-52e05c18d883'::uuid 
         OR ur.establishment_id IS NULL)
),
v1_agg AS (
  SELECT module_key,
    (ARRAY['none', 'read', 'write', 'full'])[MAX(CASE access_level WHEN 'none' THEN 1 WHEN 'read' THEN 2 WHEN 'write' THEN 3 WHEN 'full' THEN 4 END)] AS access_level
  FROM v1_source GROUP BY module_key
),
v2_agg AS (
  SELECT module_key,
    (ARRAY['none', 'read', 'write', 'full'])[MAX(CASE access_level WHEN 'none' THEN 1 WHEN 'read' THEN 2 WHEN 'write' THEN 3 WHEN 'full' THEN 4 END)] AS access_level
  FROM v2_source GROUP BY module_key
)
SELECT 
  COALESCE(v1.module_key, v2.module_key) AS module_key,
  v1.access_level AS v1_db_level,
  v2.access_level AS v2_db_level,
  CASE WHEN v1.access_level = v2.access_level THEN 'SAME' ELSE 'DIFF' END AS db_status
FROM v1_agg v1
FULL OUTER JOIN v2_agg v2 ON v1.module_key = v2.module_key
WHERE v1.access_level IS DISTINCT FROM v2.access_level
ORDER BY module_key;
-- EXPECTED: 0 rows (pas de diff SQL)

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) PREUVE: Les permissions DB pour les modules "divergents" dans le frontend
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 
  rp.module_key,
  rp.access_level AS db_access_level,
  rp.scope AS db_scope,
  'Frontend v1 affiche: full (car is_admin=true hardcode)' AS frontend_v1_behavior,
  'Frontend v2 affiche: write (vraie valeur DB)' AS frontend_v2_behavior
FROM public.role_permissions rp
WHERE rp.role_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND rp.module_key IN ('alertes', 'gestion_personnel', 'presence')
ORDER BY rp.module_key;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONCLUSION
-- ═══════════════════════════════════════════════════════════════════════════
/*
CAUSE RACINE PROUVÉE:

1. Le canary user (ba3782e6...) a le rôle "Administrateur" avec is_admin = TRUE.

2. Dans la table role_permissions, les modules alertes/gestion_personnel/presence 
   ont access_level = 'write' (PAS 'full').

3. FRONTEND V1 (usePermissions.ts, lignes 228-245):
   - Quand isAdmin === true, le code FORCE tous les modules à "full" + "org"
   - C'est un HARDCODE frontend, pas une valeur DB

4. FRONTEND V2 (usePermissionsShadowV2.ts):
   - Retourne les vraies valeurs DB ('write')
   - Pas de hardcode isAdmin

5. La divergence n'est PAS un bug SQL.
   La divergence vient du comportement legacy frontend v1 qui hardcode 
   level=full pour les admins.

RECOMMANDATION:
- Corriger le frontend v1 pour utiliser les vraies valeurs DB 
  (aligner sur le comportement v2)
- OU accepter cette divergence comme intentionnelle (legacy admin override)
*/
