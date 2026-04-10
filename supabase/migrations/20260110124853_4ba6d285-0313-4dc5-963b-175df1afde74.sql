-- =============================================
-- MIGRATION: Source de vérité unique (role_id FK only)
-- =============================================

-- 1) Backfill role_id pour tout user_roles sans role_id
-- Map les anciens enum vers les nouveaux rôles système
UPDATE public.user_roles ur
SET role_id = r.id
FROM public.roles r
WHERE ur.role_id IS NULL
  AND r.type = 'system'
  AND (
    (ur.role = 'admin' AND r.name = 'Administrateur')
    OR (ur.role = 'manager' AND r.name = 'Directeur')
    OR (ur.role = 'employee' AND r.name = 'Salarié')
  );

-- 2) Rendre role_id NOT NULL
ALTER TABLE public.user_roles ALTER COLUMN role_id SET NOT NULL;

-- 3) Supprimer la colonne enum role (source de vérité unique = role_id)
ALTER TABLE public.user_roles DROP COLUMN role;

-- 4) Supprimer l'ancien enum app_role (plus utilisé)
DROP TYPE IF EXISTS public.app_role CASCADE;

-- 5) Recréer la fonction has_role pour utiliser UNIQUEMENT role_id -> roles.name
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = _user_id
      AND r.name = _role
  )
$$;

-- 6) Supprimer is_admin (remplacée par has_role avec 'Administrateur')
DROP FUNCTION IF EXISTS public.is_admin(uuid);

-- 7) Supprimer has_role_by_name (redondant avec la nouvelle has_role)
DROP FUNCTION IF EXISTS public.has_role_by_name(uuid, text);

-- 8) Créer une nouvelle fonction is_admin simplifiée (helper)
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'Administrateur')
$$;

-- 9) Mettre à jour les RLS policies sur user_roles qui utilisaient l'ancien has_role
-- D'abord supprimer les anciennes policies
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;

-- Recréer les policies avec la nouvelle fonction
CREATE POLICY "Admins can view all roles"
ON public.user_roles
FOR SELECT
USING (public.is_admin(auth.uid()));

CREATE POLICY "Users can view own role"
ON public.user_roles
FOR SELECT
USING (user_id = auth.uid());