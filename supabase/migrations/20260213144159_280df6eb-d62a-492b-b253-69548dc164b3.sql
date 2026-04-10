-- Add DELETE RLS policies for bl_app tables
CREATE POLICY "bl_app_documents_delete" ON public.bl_app_documents
FOR DELETE USING (
  establishment_id IN (
    SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid()
  )
);

CREATE POLICY "bl_app_files_delete" ON public.bl_app_files
FOR DELETE USING (
  establishment_id IN (
    SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid()
  )
);

CREATE POLICY "bl_app_lines_delete" ON public.bl_app_lines
FOR DELETE USING (
  establishment_id IN (
    SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid()
  )
);