-- Patch V3.1 : désactiver RLS sur extra_events (policies à ajouter en V3.2/V3.3)
ALTER TABLE public.extra_events DISABLE ROW LEVEL SECURITY;