-- 1. Table organisations
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. Table établissements (liés à organisation)
CREATE TABLE public.establishments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 3. Table profiles (users liés à organisation)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index pour performances
CREATE INDEX idx_establishments_org ON public.establishments(organization_id);
CREATE INDEX idx_profiles_org ON public.profiles(organization_id);
CREATE INDEX idx_profiles_user ON public.profiles(user_id);

-- Enable RLS sur toutes les tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.establishments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Fonction helper pour récupérer l'org_id de l'utilisateur courant
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
$$;

-- RLS Policies pour ORGANIZATIONS
-- Users peuvent voir leur propre organisation
CREATE POLICY "Users can view their organization"
ON public.organizations
FOR SELECT
TO authenticated
USING (id = public.get_user_organization_id());

-- RLS Policies pour ESTABLISHMENTS
-- Users peuvent voir les établissements de leur organisation
CREATE POLICY "Users can view org establishments"
ON public.establishments
FOR SELECT
TO authenticated
USING (organization_id = public.get_user_organization_id());

-- Users peuvent créer des établissements dans leur org
CREATE POLICY "Users can insert org establishments"
ON public.establishments
FOR INSERT
TO authenticated
WITH CHECK (organization_id = public.get_user_organization_id());

-- Users peuvent modifier les établissements de leur org
CREATE POLICY "Users can update org establishments"
ON public.establishments
FOR UPDATE
TO authenticated
USING (organization_id = public.get_user_organization_id());

-- Users peuvent supprimer les établissements de leur org
CREATE POLICY "Users can delete org establishments"
ON public.establishments
FOR DELETE
TO authenticated
USING (organization_id = public.get_user_organization_id());

-- RLS Policies pour PROFILES
-- Users peuvent voir les profils de leur organisation
CREATE POLICY "Users can view org profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (organization_id = public.get_user_organization_id());

-- Users peuvent modifier leur propre profil
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

-- Trigger pour updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_establishments_updated_at
  BEFORE UPDATE ON public.establishments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();