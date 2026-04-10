-- ÉTAPE 52: SAFETY LOCK - Empêcher nouvelles écritures legacy (establishment_id NULL)
-- Migration idempotente avec triggers de validation

-- ============================================
-- PHASE 1: Trigger pour user_roles
-- ============================================

-- Supprimer le trigger existant s'il existe (idempotent)
DROP TRIGGER IF EXISTS trg_user_roles_require_establishment ON public.user_roles;
DROP FUNCTION IF EXISTS public.fn_user_roles_require_establishment();

-- Créer la fonction de validation
CREATE OR REPLACE FUNCTION public.fn_user_roles_require_establishment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.establishment_id IS NULL THEN
    RAISE EXCEPTION 'Phase 2 lock: establishment_id cannot be NULL for user_roles. Legacy NULL assignments are forbidden.';
  END IF;
  RETURN NEW;
END;
$$;

-- Ajouter un commentaire explicite
COMMENT ON FUNCTION public.fn_user_roles_require_establishment() IS 
  'Phase 2 lock: legacy NULL assignments forbidden. All user_roles must be scoped to an establishment.';

-- Créer le trigger sur INSERT et UPDATE
CREATE TRIGGER trg_user_roles_require_establishment
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_user_roles_require_establishment();

-- ============================================
-- PHASE 2: Trigger pour user_teams
-- ============================================

-- Supprimer le trigger existant s'il existe (idempotent)
DROP TRIGGER IF EXISTS trg_user_teams_require_establishment ON public.user_teams;
DROP FUNCTION IF EXISTS public.fn_user_teams_require_establishment();

-- Créer la fonction de validation
CREATE OR REPLACE FUNCTION public.fn_user_teams_require_establishment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.establishment_id IS NULL THEN
    RAISE EXCEPTION 'Phase 2 lock: establishment_id cannot be NULL for user_teams. Legacy NULL assignments are forbidden.';
  END IF;
  RETURN NEW;
END;
$$;

-- Ajouter un commentaire explicite
COMMENT ON FUNCTION public.fn_user_teams_require_establishment() IS 
  'Phase 2 lock: legacy NULL assignments forbidden. All user_teams must be scoped to an establishment.';

-- Créer le trigger sur INSERT et UPDATE
CREATE TRIGGER trg_user_teams_require_establishment
  BEFORE INSERT OR UPDATE ON public.user_teams
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_user_teams_require_establishment();