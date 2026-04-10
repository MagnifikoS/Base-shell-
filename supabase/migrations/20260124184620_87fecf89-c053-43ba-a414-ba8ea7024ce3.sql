-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2 / ÉTAPE 1 — RBAC PAR ÉTABLISSEMENT (DB ONLY)
-- Migrations additives + remplacement contraintes UNIQUE legacy
-- ═══════════════════════════════════════════════════════════════════════════

-- (1A) Ajouter establishment_id nullable à user_roles
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS establishment_id uuid NULL
  REFERENCES public.establishments(id) ON DELETE CASCADE;

-- (1B) Ajouter establishment_id nullable à user_teams
ALTER TABLE public.user_teams
  ADD COLUMN IF NOT EXISTS establishment_id uuid NULL
  REFERENCES public.establishments(id) ON DELETE CASCADE;

-- (2A) Drop contraintes legacy (bloquent multi-établissements)
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_id_key;
ALTER TABLE public.user_teams DROP CONSTRAINT IF EXISTS user_teams_user_id_team_id_key;

-- (2B) Créer uniques scoped (nouveau modèle multi-établissement)
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_est_uniq
  ON public.user_roles(user_id, role_id, establishment_id);

CREATE UNIQUE INDEX IF NOT EXISTS user_teams_user_team_est_uniq
  ON public.user_teams(user_id, team_id, establishment_id);

-- (2C) Créer uniques legacy global (partiels sur NULL - préserve comportement existant)
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_global_uniq
  ON public.user_roles(user_id, role_id)
  WHERE establishment_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_teams_user_team_global_uniq
  ON public.user_teams(user_id, team_id)
  WHERE establishment_id IS NULL;

-- (3) Index perf non-unique pour requêtes futures
CREATE INDEX IF NOT EXISTS user_roles_user_est_idx
  ON public.user_roles(user_id, establishment_id);

CREATE INDEX IF NOT EXISTS user_teams_user_est_idx
  ON public.user_teams(user_id, establishment_id);