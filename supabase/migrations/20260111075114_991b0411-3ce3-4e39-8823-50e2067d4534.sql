-- =============================================
-- FIX: Add WITH CHECK to admin storage policy
-- =============================================
DROP POLICY IF EXISTS "Admins can manage employee documents storage" ON storage.objects;

CREATE POLICY "Admins can manage employee documents storage"
ON storage.objects
FOR ALL
USING (
  bucket_id = 'employee-documents'
  AND (storage.foldername(name))[1] = get_user_organization_id()::text
  AND is_admin(auth.uid())
)
WITH CHECK (
  bucket_id = 'employee-documents'
  AND (storage.foldername(name))[1] = get_user_organization_id()::text
  AND is_admin(auth.uid())
);