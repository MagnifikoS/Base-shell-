-- Fix overly permissive storage RLS for return-photos bucket
-- Replace broad policies with establishment-scoped access

DROP POLICY IF EXISTS "Auth users can upload return photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can view return photos" ON storage.objects;

-- Upload: only if user owns returns in their establishment
CREATE POLICY "Return photo upload scoped to own returns"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'return-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.product_returns
      WHERE created_by = auth.uid()
        AND client_establishment_id IN (
          SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid()
        )
    )
  );

-- View: only if user belongs to client or supplier establishment of the return
CREATE POLICY "Return photo view scoped to stakeholders"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'return-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.product_returns
      WHERE client_establishment_id IN (
          SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid()
        )
        OR supplier_establishment_id IN (
          SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid()
        )
    )
  );