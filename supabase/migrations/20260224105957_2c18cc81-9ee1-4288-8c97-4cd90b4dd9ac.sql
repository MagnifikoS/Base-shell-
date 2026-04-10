
-- Fix: Allow org members to see fournisseur-type establishments for ordering
-- Current policy only allows users to see establishments they're assigned to.
-- This prevents restaurant users from seeing the fournisseur they need to order from.

DROP POLICY IF EXISTS "Users can view assigned establishments" ON public.establishments;

CREATE POLICY "Users can view accessible establishments"
  ON public.establishments FOR SELECT
  USING (
    -- User is assigned to this establishment
    id IN (SELECT get_user_establishment_ids())
    OR
    -- User can see fournisseur establishments in their own organization
    (
      establishment_type = 'fournisseur'
      AND organization_id = get_user_organization_id()
    )
  );
