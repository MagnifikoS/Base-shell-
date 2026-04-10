-- Ajout de la colonne is_test à la table invitations pour identifier les utilisateurs test
-- Cette colonne permet d'isoler complètement le mode test pour suppression future

ALTER TABLE public.invitations 
ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

-- Index pour les requêtes filtrées sur is_test
CREATE INDEX IF NOT EXISTS idx_invitations_is_test ON public.invitations (is_test) WHERE is_test = true;