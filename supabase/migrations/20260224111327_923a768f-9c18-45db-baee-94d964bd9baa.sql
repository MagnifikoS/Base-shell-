-- Fix: Allow org members to view products from fournisseur establishments (for Commande Produits)
DROP POLICY IF EXISTS "Users can view products_v2 in their establishments" ON public.products_v2;

CREATE POLICY "Users can view accessible products_v2"
  ON public.products_v2 FOR SELECT
  USING (
    -- User is assigned to this establishment
    establishment_id IN (SELECT get_user_establishment_ids())
    OR
    -- User can see products from fournisseur establishments in their own organization
    EXISTS (
      SELECT 1 FROM establishments e
      WHERE e.id = products_v2.establishment_id
        AND e.establishment_type = 'fournisseur'
        AND e.organization_id = get_user_organization_id()
    )
  );