-- B1: Fix commandes_update RLS — block modifications when status = 'ouverte'
DROP POLICY IF EXISTS "commandes_update" ON public.commandes;
CREATE POLICY "commandes_update" ON public.commandes
  FOR UPDATE TO authenticated
  USING (
    client_establishment_id IN (SELECT public.get_user_establishment_ids())
    AND status <> 'ouverte'
  );

-- B1: Fix commande_lines_insert — block adding lines to opened commandes
DROP POLICY IF EXISTS "commande_lines_insert" ON public.commande_lines;
CREATE POLICY "commande_lines_insert" ON public.commande_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.commandes c
      WHERE c.id = commande_id
      AND c.client_establishment_id IN (SELECT public.get_user_establishment_ids())
      AND c.status <> 'ouverte'
    )
  );