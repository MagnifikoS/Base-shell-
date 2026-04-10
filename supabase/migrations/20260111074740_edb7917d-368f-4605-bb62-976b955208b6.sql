-- =============================================
-- IDEMPOTENT FIX: Storage bucket
-- =============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-documents', 'employee-documents', false)
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- IDEMPOTENT FIX: Indexes (DROP IF EXISTS + CREATE)
-- =============================================
DROP INDEX IF EXISTS public.idx_employee_documents_org_user;
CREATE INDEX idx_employee_documents_org_user ON public.employee_documents(organization_id, user_id);

DROP INDEX IF EXISTS public.idx_employee_documents_user_id;
CREATE INDEX idx_employee_documents_user_id ON public.employee_documents(user_id);

-- =============================================
-- IDEMPOTENT FIX: RLS Policies (DROP IF EXISTS + CREATE)
-- =============================================
DROP POLICY IF EXISTS "Admins can view org employee documents" ON public.employee_documents;
CREATE POLICY "Admins can view org employee documents"
ON public.employee_documents
FOR SELECT
USING (
  organization_id = get_user_organization_id()
  AND is_admin(auth.uid())
);

DROP POLICY IF EXISTS "Employees can view own documents" ON public.employee_documents;
CREATE POLICY "Employees can view own documents"
ON public.employee_documents
FOR SELECT
USING (user_id = auth.uid());

-- =============================================
-- IDEMPOTENT FIX: Storage Policies (DROP IF EXISTS + CREATE)
-- =============================================
DROP POLICY IF EXISTS "Admins can manage employee documents storage" ON storage.objects;
CREATE POLICY "Admins can manage employee documents storage"
ON storage.objects
FOR ALL
USING (
  bucket_id = 'employee-documents'
  AND (storage.foldername(name))[1] IN (
    SELECT get_user_organization_id()::text
  )
  AND is_admin(auth.uid())
);

DROP POLICY IF EXISTS "Employees can read own documents storage" ON storage.objects;
CREATE POLICY "Employees can read own documents storage"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'employee-documents'
  AND (storage.foldername(name))[1] = get_user_organization_id()::text
  AND (storage.foldername(name))[2] = auth.uid()::text
);