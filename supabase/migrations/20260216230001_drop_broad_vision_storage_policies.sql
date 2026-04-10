-- ═══════════════════════════════════════════════════════════════════════════
-- SEC-AUTH-020: Drop overly broad vision-ia-documents storage policies
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Migration 20260204081123 created broad storage policies on storage.objects
-- for bucket 'vision-ia-documents' that allow ANY authenticated user to
-- read/write/delete ANY file in the bucket (no owner scoping).
--
-- Migration 20260204102923 later added properly owner-scoped policies
-- (vision_ia_storage_*_owner) that restrict access to files in the user's
-- own folder (auth.uid()::text = foldername(name)[1]).
--
-- The broad policies MUST be dropped because PostgreSQL storage RLS is
-- permissive-OR: if ANY policy grants access, the operation is allowed.
-- The owner-scoped policies are rendered useless while the broad ones exist.
--
-- NOTE: There was no "vision_ia_documents_update_policy" in the original
-- migration — only insert, select, and delete were created.
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the broad (non-owner-scoped) policies from migration 20260204081123
DROP POLICY IF EXISTS "vision_ia_documents_insert_policy" ON storage.objects;
DROP POLICY IF EXISTS "vision_ia_documents_select_policy" ON storage.objects;
DROP POLICY IF EXISTS "vision_ia_documents_delete_policy" ON storage.objects;

-- Safety: also drop an update policy if it somehow exists
DROP POLICY IF EXISTS "vision_ia_documents_update_policy" ON storage.objects;

-- Verify: the following owner-scoped policies from 20260204102923 remain:
--   vision_ia_storage_select_owner
--   vision_ia_storage_insert_owner
--   vision_ia_storage_update_owner
--   vision_ia_storage_delete_owner
