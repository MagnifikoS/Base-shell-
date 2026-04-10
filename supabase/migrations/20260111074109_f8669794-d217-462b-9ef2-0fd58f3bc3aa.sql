-- =============================================
-- TABLE: employee_documents
-- =============================================
CREATE TABLE public.employee_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('piece_identite', 'contrat', 'autre')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID NOT NULL
);

-- Indexes for efficient queries
CREATE INDEX idx_employee_documents_org_user ON public.employee_documents(organization_id, user_id);
CREATE INDEX idx_employee_documents_user_id ON public.employee_documents(user_id);

-- Enable RLS
ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;

-- Policy: Admin can view documents of their org
CREATE POLICY "Admins can view org employee documents"
ON public.employee_documents
FOR SELECT
USING (
  organization_id = get_user_organization_id()
  AND is_admin(auth.uid())
);

-- Policy: Employee can view their own documents only
CREATE POLICY "Employees can view own documents"
ON public.employee_documents
FOR SELECT
USING (user_id = auth.uid());

-- =============================================
-- STORAGE BUCKET: employee-documents (private)
-- =============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-documents', 'employee-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: Admin upload (via service role) handled in edge function
-- Employee can only view their own files via signed URL (edge function)
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

-- Employees can read their own documents
CREATE POLICY "Employees can read own documents storage"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'employee-documents'
  AND (storage.foldername(name))[1] = get_user_organization_id()::text
  AND (storage.foldername(name))[2] = auth.uid()::text
);