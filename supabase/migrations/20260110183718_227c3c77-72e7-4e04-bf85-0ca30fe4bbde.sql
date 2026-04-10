-- A) Supprimer UNIQUEMENT la contrainte modules_name_unique
-- Les garde-fous anti-récidive (CHECK constraints) sont CONSERVÉS

ALTER TABLE public.modules DROP CONSTRAINT IF EXISTS modules_name_unique;