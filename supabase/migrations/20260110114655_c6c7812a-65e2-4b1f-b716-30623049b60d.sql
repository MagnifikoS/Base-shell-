-- Supprimer les policies d'écriture sur establishments
DROP POLICY IF EXISTS "Users can insert org establishments" ON public.establishments;
DROP POLICY IF EXISTS "Users can update org establishments" ON public.establishments;
DROP POLICY IF EXISTS "Users can delete org establishments" ON public.establishments;

-- Seul SELECT reste actif via "Users can view org establishments"