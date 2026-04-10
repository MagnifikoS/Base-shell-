
-- Drop the duplicate/obsolete resolve_commande_user_names function
DROP FUNCTION IF EXISTS public.resolve_commande_user_names(text[]);

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
