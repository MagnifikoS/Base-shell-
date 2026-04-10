-- Migration: Add doc_type support to vision_ai_scans and vision_ai_scan_runs
-- Supports BL (bon de livraison) and Releve document types alongside existing factures.
-- Backward compatible: existing rows default to 'facture'.

-- Add doc_type to vision_ai_scans with default 'facture'
ALTER TABLE vision_ai_scans ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'facture';
ALTER TABLE vision_ai_scans ADD CONSTRAINT chk_scan_doc_type CHECK (doc_type IN ('facture', 'bl', 'releve'));

-- Add BL-specific fields
ALTER TABLE vision_ai_scans ADD COLUMN IF NOT EXISTS bl_number TEXT;

-- Add Releve-specific fields
ALTER TABLE vision_ai_scans ADD COLUMN IF NOT EXISTS releve_period_start DATE;
ALTER TABLE vision_ai_scans ADD COLUMN IF NOT EXISTS releve_period_end DATE;

-- Add doc_type to vision_ai_scan_runs
ALTER TABLE vision_ai_scan_runs ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'facture';

-- Add BL result columns
ALTER TABLE vision_ai_scan_runs ADD COLUMN IF NOT EXISTS result_bl JSONB;
ALTER TABLE vision_ai_scan_runs ADD COLUMN IF NOT EXISTS result_bl_items JSONB;

-- Add Releve result columns
ALTER TABLE vision_ai_scan_runs ADD COLUMN IF NOT EXISTS result_releve JSONB;
ALTER TABLE vision_ai_scan_runs ADD COLUMN IF NOT EXISTS result_releve_lines JSONB;
ALTER TABLE vision_ai_scan_runs ADD COLUMN IF NOT EXISTS result_reconciliation JSONB;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scans_doc_type ON vision_ai_scans (doc_type, establishment_id);
CREATE INDEX IF NOT EXISTS idx_scan_runs_doc_type ON vision_ai_scan_runs (doc_type);
