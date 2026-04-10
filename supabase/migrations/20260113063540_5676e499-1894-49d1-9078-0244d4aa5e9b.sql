-- Ajouter colonne second_first_name dans profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS second_first_name TEXT;