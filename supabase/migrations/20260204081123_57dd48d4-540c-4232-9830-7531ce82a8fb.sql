-- ═══════════════════════════════════════════════════════════════════════════
-- VISION IA V2 — Storage Bucket (100% ISOLÉ)
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- Bucket dédié pour les documents Vision IA
-- Aucune relation avec les tables métier existantes
-- Supprimable sans impact sur l'application
--
-- ═══════════════════════════════════════════════════════════════════════════

-- Create storage bucket for Vision IA documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vision-ia-documents',
  'vision-ia-documents',
  false,
  52428800, -- 50MB max
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff']
)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for Vision IA documents bucket
-- Only authenticated users can upload/read their own documents

-- Allow authenticated users to upload documents
CREATE POLICY "vision_ia_documents_insert_policy"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'vision-ia-documents');

-- Allow authenticated users to read their own documents
CREATE POLICY "vision_ia_documents_select_policy"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'vision-ia-documents');

-- Allow authenticated users to delete their own documents
CREATE POLICY "vision_ia_documents_delete_policy"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'vision-ia-documents');