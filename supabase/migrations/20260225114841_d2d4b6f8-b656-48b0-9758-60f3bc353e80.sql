-- Allow users to view BL withdrawal documents where their establishment is the destination
-- This enables cross-org visibility: if Sapori sends a BL to Labaja, Labaja users can see it
CREATE POLICY "Destination users can view bl_withdrawal_documents"
  ON public.bl_withdrawal_documents
  FOR SELECT
  USING (
    destination_establishment_id IN (
      SELECT ur.establishment_id
      FROM user_roles ur
      WHERE ur.user_id = auth.uid()
    )
  );

-- Same for bl_withdrawal_lines: allow reading lines of BLs visible to the user
-- Current policy is likely org-based, let's check and add destination-based access
DO $$
BEGIN
  -- Drop existing line policy if too restrictive, and recreate with broader access
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'bl_withdrawal_lines' 
    AND policyname = 'Destination users can view bl_withdrawal_lines'
  ) THEN
    EXECUTE 'CREATE POLICY "Destination users can view bl_withdrawal_lines"
      ON public.bl_withdrawal_lines
      FOR SELECT
      USING (
        bl_withdrawal_document_id IN (
          SELECT id FROM bl_withdrawal_documents
          WHERE destination_establishment_id IN (
            SELECT ur.establishment_id
            FROM user_roles ur
            WHERE ur.user_id = auth.uid()
          )
        )
      )';
  END IF;
END $$;