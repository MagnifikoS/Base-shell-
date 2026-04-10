-- ═══════════════════════════════════════════════════════════════════════════
-- P0-SEC: Add missing DELETE policy on bl_app storage bucket
-- The invoices bucket already has SELECT/INSERT/DELETE policies.
-- The bl_app bucket only had SELECT and INSERT — missing DELETE.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE POLICY "bl_app_storage_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'bl_app'
    AND (storage.foldername(name))[1] = 'establishments'
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.establishments
      WHERE id IN (SELECT public.get_user_establishment_ids())
    )
  );