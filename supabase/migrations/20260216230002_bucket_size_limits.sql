-- ═══════════════════════════════════════════════════════════════════════════
-- SEC-AUTH-021: Set file size limits on bl_app and supplier-logos buckets
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Previous migration 20260215000001 set limits on employee-documents,
-- invoices, and vision-ia-documents. This adds limits to the remaining
-- buckets that were created later:
--   - bl_app (created in 20260213135124) — 10 MB for delivery note photos
--   - supplier-logos (created in 20260215063702) — 5 MB for logo images
--
-- Without limits, users could upload arbitrarily large files consuming
-- storage and potentially causing denial-of-service.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE storage.buckets SET file_size_limit = 10485760  WHERE id = 'bl_app';          -- 10 MB
UPDATE storage.buckets SET file_size_limit = 5242880   WHERE id = 'supplier-logos';   -- 5 MB
