-- 1) Enum pour le statut des établissements
CREATE TYPE public.establishment_status AS ENUM ('active', 'archived');

-- 2) Ajouter colonne status à establishments
ALTER TABLE public.establishments 
ADD COLUMN status public.establishment_status NOT NULL DEFAULT 'active';

-- 3) Table d'assignation utilisateur → établissement
CREATE TABLE public.user_establishments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, establishment_id)
);

-- 4) Activer RLS sur user_establishments
ALTER TABLE public.user_establishments ENABLE ROW LEVEL SECURITY;

-- 5) Fonction pour récupérer les établissements assignés à un utilisateur
CREATE OR REPLACE FUNCTION public.get_user_establishment_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT establishment_id 
  FROM public.user_establishments 
  WHERE user_id = auth.uid()
$$;

-- 6) RLS sur user_establishments : SELECT uniquement ses propres assignations
CREATE POLICY "Users can view own assignments"
ON public.user_establishments
FOR SELECT
USING (user_id = auth.uid());

-- 7) Supprimer l'ancienne policy SELECT sur establishments (basée sur org)
DROP POLICY IF EXISTS "Users can view org establishments" ON public.establishments;

-- 8) Nouvelle policy SELECT sur establishments : basée sur assignation
CREATE POLICY "Users can view assigned establishments"
ON public.establishments
FOR SELECT
USING (id IN (SELECT public.get_user_establishment_ids()));