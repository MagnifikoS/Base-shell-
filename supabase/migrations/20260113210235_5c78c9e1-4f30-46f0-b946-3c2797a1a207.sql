-- ═══════════════════════════════════════════════════════════════════════════
-- PATCH A — Trigger immutabilité organization_id + user_id sur profiles
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Créer la fonction trigger (SECURITY DEFINER pour accès sécurisé)
CREATE OR REPLACE FUNCTION public.prevent_profile_identity_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Bloquer tout changement de organization_id
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Cannot change organization_id';
  END IF;
  
  -- Bloquer tout changement de user_id
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Cannot change user_id';
  END IF;
  
  RETURN NEW;
END;
$$;

-- 2) Révoquer l'exécution publique (surface d'attaque minimale)
REVOKE EXECUTE ON FUNCTION public.prevent_profile_identity_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_identity_change() FROM anon;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_identity_change() FROM authenticated;

-- 3) Créer le trigger (idempotent)
DROP TRIGGER IF EXISTS prevent_profile_identity_change_trigger ON public.profiles;
CREATE TRIGGER prevent_profile_identity_change_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_identity_change();

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK SQL (à conserver pour référence):
-- DROP TRIGGER IF EXISTS prevent_profile_identity_change_trigger ON public.profiles;
-- DROP FUNCTION IF EXISTS public.prevent_profile_identity_change();
-- ═══════════════════════════════════════════════════════════════════════════