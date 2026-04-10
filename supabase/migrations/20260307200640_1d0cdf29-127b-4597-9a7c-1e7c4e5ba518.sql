-- Fix all 4 RLS policies: profiles.id → profiles.user_id

DROP POLICY "Users can read dismissed suggestions for their establishment" ON public.inventory_mutualisation_dismissed;
DROP POLICY "Users can insert dismissed suggestions for their establishment" ON public.inventory_mutualisation_dismissed;
DROP POLICY "Users can update dismissed suggestions for their establishment" ON public.inventory_mutualisation_dismissed;
DROP POLICY "Users can delete dismissed suggestions for their establishment" ON public.inventory_mutualisation_dismissed;

CREATE POLICY "Users can read dismissed suggestions for their establishment"
ON public.inventory_mutualisation_dismissed FOR SELECT TO authenticated
USING (
  establishment_id IN (
    SELECT e.id FROM establishments e
    WHERE e.organization_id IN (
      SELECT p.organization_id FROM profiles p WHERE p.user_id = auth.uid()
    )
  )
);

CREATE POLICY "Users can insert dismissed suggestions for their establishment"
ON public.inventory_mutualisation_dismissed FOR INSERT TO authenticated
WITH CHECK (
  establishment_id IN (
    SELECT e.id FROM establishments e
    WHERE e.organization_id IN (
      SELECT p.organization_id FROM profiles p WHERE p.user_id = auth.uid()
    )
  )
);

CREATE POLICY "Users can update dismissed suggestions for their establishment"
ON public.inventory_mutualisation_dismissed FOR UPDATE TO authenticated
USING (
  establishment_id IN (
    SELECT e.id FROM establishments e
    WHERE e.organization_id IN (
      SELECT p.organization_id FROM profiles p WHERE p.user_id = auth.uid()
    )
  )
)
WITH CHECK (
  establishment_id IN (
    SELECT e.id FROM establishments e
    WHERE e.organization_id IN (
      SELECT p.organization_id FROM profiles p WHERE p.user_id = auth.uid()
    )
  )
);

CREATE POLICY "Users can delete dismissed suggestions for their establishment"
ON public.inventory_mutualisation_dismissed FOR DELETE TO authenticated
USING (
  establishment_id IN (
    SELECT e.id FROM establishments e
    WHERE e.organization_id IN (
      SELECT p.organization_id FROM profiles p WHERE p.user_id = auth.uid()
    )
  )
);