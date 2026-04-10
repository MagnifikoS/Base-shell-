-- Part 1: Drop legacy triggers and functions
DROP TRIGGER IF EXISTS prevent_profile_identity_change_trigger ON public.profiles;
DROP FUNCTION IF EXISTS public.prevent_profile_identity_change();
