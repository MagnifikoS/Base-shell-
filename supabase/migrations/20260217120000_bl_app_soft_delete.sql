-- ═══════════════════════════════════════════════════════════════════════════
-- STK-BL-018: Add soft-delete columns to bl_app_documents
-- Instead of hard-deleting BL-APP documents on void, we mark them.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE bl_app_documents
  ADD COLUMN IF NOT EXISTS voided_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS void_reason text DEFAULT NULL;

-- Index for efficient filtering of non-voided documents
CREATE INDEX IF NOT EXISTS idx_bl_app_documents_voided_at
  ON bl_app_documents (voided_at)
  WHERE voided_at IS NULL;

COMMENT ON COLUMN bl_app_documents.voided_at IS 'Timestamp when the BL-APP was voided (soft-delete). NULL = active.';
COMMENT ON COLUMN bl_app_documents.void_reason IS 'Reason for voiding the BL-APP document.';
