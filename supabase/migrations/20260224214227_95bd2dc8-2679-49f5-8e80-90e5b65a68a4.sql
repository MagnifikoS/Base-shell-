-- Allow authenticated users to READ module selections for establishments they belong to
CREATE POLICY "users_read_own_establishment_modules"
  ON public.platform_establishment_module_selections
  FOR SELECT
  TO authenticated
  USING (
    establishment_id IN (
      SELECT ue.establishment_id
      FROM public.user_establishments ue
      WHERE ue.user_id = auth.uid()
    )
  );