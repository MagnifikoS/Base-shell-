CREATE POLICY "Users can update dismissed suggestions for their establishment"
ON public.inventory_mutualisation_dismissed
FOR UPDATE
TO authenticated
USING (
  establishment_id IN (
    SELECT e.id FROM establishments e
    WHERE e.organization_id IN (
      SELECT profiles.organization_id FROM profiles WHERE profiles.id = auth.uid()
    )
  )
)
WITH CHECK (
  establishment_id IN (
    SELECT e.id FROM establishments e
    WHERE e.organization_id IN (
      SELECT profiles.organization_id FROM profiles WHERE profiles.id = auth.uid()
    )
  )
);