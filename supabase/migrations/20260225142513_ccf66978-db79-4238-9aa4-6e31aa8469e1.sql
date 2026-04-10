
-- Allow users from the same org to UPDATE bl_withdrawal_lines (for correction flow)
CREATE POLICY "Users can update bl_withdrawal_lines via parent doc"
ON public.bl_withdrawal_lines
FOR UPDATE
USING (
  bl_withdrawal_document_id IN (
    SELECT id FROM public.bl_withdrawal_documents
    WHERE organization_id IN (
      SELECT organization_id FROM public.user_establishments ue
      JOIN public.establishments e ON e.id = ue.establishment_id
      WHERE ue.user_id = auth.uid()
    )
  )
)
WITH CHECK (
  bl_withdrawal_document_id IN (
    SELECT id FROM public.bl_withdrawal_documents
    WHERE organization_id IN (
      SELECT organization_id FROM public.user_establishments ue
      JOIN public.establishments e ON e.id = ue.establishment_id
      WHERE ue.user_id = auth.uid()
    )
  )
);

-- Allow users from the same org to UPDATE bl_withdrawal_documents (for correction total_eur)
CREATE POLICY "Users can update bl_withdrawal_documents in their org"
ON public.bl_withdrawal_documents
FOR UPDATE
USING (
  organization_id IN (
    SELECT e.organization_id
    FROM public.user_establishments ue
    JOIN public.establishments e ON e.id = ue.establishment_id
    WHERE ue.user_id = auth.uid()
  )
)
WITH CHECK (
  organization_id IN (
    SELECT e.organization_id
    FROM public.user_establishments ue
    JOIN public.establishments e ON e.id = ue.establishment_id
    WHERE ue.user_id = auth.uid()
  )
);

-- Also allow destination org (cross-org supplier correction) to UPDATE bl_withdrawal_lines
CREATE POLICY "Destination users can update bl_withdrawal_lines"
ON public.bl_withdrawal_lines
FOR UPDATE
USING (
  bl_withdrawal_document_id IN (
    SELECT bwd.id FROM public.bl_withdrawal_documents bwd
    WHERE public.user_belongs_to_establishment(auth.uid(), bwd.destination_establishment_id)
  )
)
WITH CHECK (
  bl_withdrawal_document_id IN (
    SELECT bwd.id FROM public.bl_withdrawal_documents bwd
    WHERE public.user_belongs_to_establishment(auth.uid(), bwd.destination_establishment_id)
  )
);

-- Allow destination org to UPDATE bl_withdrawal_documents (for total_eur correction)
CREATE POLICY "Destination users can update bl_withdrawal_documents"
ON public.bl_withdrawal_documents
FOR UPDATE
USING (
  public.user_belongs_to_establishment(auth.uid(), destination_establishment_id)
)
WITH CHECK (
  public.user_belongs_to_establishment(auth.uid(), destination_establishment_id)
);
