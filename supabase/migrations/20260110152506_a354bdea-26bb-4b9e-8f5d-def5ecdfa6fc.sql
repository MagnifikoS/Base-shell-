-- ============================================================
-- MIGRATION : Ajouter invitations.user_id (lien UUID direct)
-- ============================================================
-- Objectif : Lier les invitations aux users via UUID, pas email
-- ============================================================

-- 1) Ajouter la colonne user_id nullable
ALTER TABLE public.invitations 
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2) Créer un index pour les requêtes par user_id
CREATE INDEX IF NOT EXISTS idx_invitations_user_id ON public.invitations(user_id);

-- 3) Backfill : remplir user_id en retrouvant le user via profiles.email
UPDATE public.invitations i
SET user_id = p.user_id
FROM public.profiles p
WHERE i.email = p.email
AND i.user_id IS NULL;