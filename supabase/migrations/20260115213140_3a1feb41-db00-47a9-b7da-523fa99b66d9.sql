-- 1) SÉCURITÉ PIN: Supprimer la policy SELECT qui expose pin_hash
DROP POLICY IF EXISTS "Users can view own pin existence" ON public.user_badge_pins;

-- 2) Interdire également UPDATE direct (doit passer par edge)
DROP POLICY IF EXISTS "Users can update own pin" ON public.user_badge_pins;

-- 3) Seul le service_role peut lire/écrire sur cette table
-- Les users passent par l'edge function badge-pin