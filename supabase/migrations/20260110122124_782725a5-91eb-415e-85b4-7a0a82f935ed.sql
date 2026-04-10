-- ============================================
-- 1) TABLE modules (référence canonique)
-- ============================================
CREATE TABLE public.modules (
  key TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Activer RLS
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;

-- Policy SELECT pour tous les authentifiés
CREATE POLICY "Authenticated users can view modules"
ON public.modules FOR SELECT
TO authenticated
USING (true);

-- Seed des modules canoniques
INSERT INTO public.modules (key, name, display_order) VALUES
  ('dashboard', 'Dashboard', 1),
  ('planning', 'Planning', 2),
  ('salaries', 'Salariés', 3),
  ('badgeuse', 'Badgeuse', 4),
  ('caisse', 'Caisse', 5),
  ('rapports', 'Rapports / Stats', 6),
  ('parametres', 'Paramètres', 7),
  ('utilisateurs', 'Utilisateurs', 8),
  ('roles_permissions', 'Rôles & permissions', 9),
  ('teams', 'Teams', 10),
  ('etablissements', 'Établissements', 11);

-- ============================================
-- 2) TABLE roles
-- ============================================
CREATE TABLE public.roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('system', 'custom')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

-- Activer RLS
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

-- Policy SELECT : rôles system (org_id NULL) OU rôles de l'org de l'utilisateur
CREATE POLICY "Users can view system and org roles"
ON public.roles FOR SELECT
TO authenticated
USING (
  organization_id IS NULL 
  OR organization_id = get_user_organization_id()
);

-- Trigger updated_at
CREATE TRIGGER update_roles_updated_at
BEFORE UPDATE ON public.roles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 3) SEED RÔLES SYSTÈME (organization_id = NULL)
-- ============================================
INSERT INTO public.roles (id, organization_id, name, type) VALUES
  ('00000000-0000-0000-0000-000000000001', NULL, 'Administrateur', 'system'),
  ('00000000-0000-0000-0000-000000000002', NULL, 'Super Admin', 'system'),
  ('00000000-0000-0000-0000-000000000003', NULL, 'Directeur', 'system'),
  ('00000000-0000-0000-0000-000000000004', NULL, 'Salarié', 'system'),
  ('00000000-0000-0000-0000-000000000005', NULL, 'Caissier', 'system'),
  ('00000000-0000-0000-0000-000000000006', NULL, 'Autres', 'system');

-- ============================================
-- 4) TABLE role_permissions
-- ============================================
CREATE TYPE public.access_level AS ENUM ('none', 'read', 'write', 'full');
CREATE TYPE public.permission_scope AS ENUM ('self', 'team', 'establishment', 'org');

CREATE TABLE public.role_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL REFERENCES public.modules(key) ON DELETE CASCADE,
  access_level public.access_level NOT NULL DEFAULT 'none',
  scope public.permission_scope NOT NULL DEFAULT 'self',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (role_id, module_key)
);

-- Activer RLS
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- Policy SELECT : permissions des rôles visibles par l'utilisateur
CREATE POLICY "Users can view permissions for visible roles"
ON public.role_permissions FOR SELECT
TO authenticated
USING (
  role_id IN (
    SELECT id FROM public.roles 
    WHERE organization_id IS NULL 
    OR organization_id = get_user_organization_id()
  )
);

-- Trigger updated_at
CREATE TRIGGER update_role_permissions_updated_at
BEFORE UPDATE ON public.role_permissions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 5) SEED PERMISSIONS ADMINISTRATEUR (full/org sur tout)
-- ============================================
INSERT INTO public.role_permissions (role_id, module_key, access_level, scope)
SELECT 
  '00000000-0000-0000-0000-000000000001'::uuid,
  key,
  'full'::public.access_level,
  'org'::public.permission_scope
FROM public.modules;

-- ============================================
-- 6) SEED PERMISSIONS AUTRES RÔLES (none/self par défaut)
-- ============================================
INSERT INTO public.role_permissions (role_id, module_key, access_level, scope)
SELECT 
  r.id,
  m.key,
  'none'::public.access_level,
  'self'::public.permission_scope
FROM public.roles r
CROSS JOIN public.modules m
WHERE r.id != '00000000-0000-0000-0000-000000000001'::uuid
  AND r.type = 'system';

-- ============================================
-- 7) MIGRATION user_roles : ajouter role_id
-- ============================================
-- Ajouter colonne role_id (nullable temporairement)
ALTER TABLE public.user_roles 
ADD COLUMN role_id UUID REFERENCES public.roles(id) ON DELETE SET NULL;

-- Migrer les données existantes : admin -> Administrateur
UPDATE public.user_roles 
SET role_id = '00000000-0000-0000-0000-000000000001'::uuid
WHERE role = 'admin';

-- Migrer manager -> Directeur
UPDATE public.user_roles 
SET role_id = '00000000-0000-0000-0000-000000000003'::uuid
WHERE role = 'manager';

-- Migrer employee -> Salarié
UPDATE public.user_roles 
SET role_id = '00000000-0000-0000-0000-000000000004'::uuid
WHERE role = 'employee';

-- ============================================
-- 8) FONCTION has_role_by_name (nouvelle version)
-- ============================================
CREATE OR REPLACE FUNCTION public.has_role_by_name(_user_id uuid, _role_name text)
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
      AND r.name = _role_name
  )
$$;

-- ============================================
-- 9) FONCTION is_admin (helper)
-- ============================================
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        ur.role = 'admin'::app_role
        OR ur.role_id = '00000000-0000-0000-0000-000000000001'::uuid
      )
  )
$$;