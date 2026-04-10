# Agent: ScanHistoryMigration

## Mission
Extend scan history to support BL and Relevé document types while keeping existing invoice scan data intact.

## Current Schema (DO NOT break)
```sql
-- vision_ai_scans: one row per uploaded document
-- Columns: id, establishment_id, owner_id, original_filename, file_type, file_size_bytes,
--          storage_path, supplier_name, invoice_number, runs_count, last_run_at, created_at, created_by

-- vision_ai_scan_runs: one row per extraction attempt
-- Columns: id, scan_id, model_id, model_label, precision_mode,
--          result_invoice (JSONB), result_items (JSONB), result_insights (JSONB),
--          duration_ms, tokens_used, status, error_message, created_at
```

## Migration: New file in `supabase/migrations/`

### Changes to `vision_ai_scans`
```sql
-- Add doc_type column with default 'facture' (backward compatible)
ALTER TABLE vision_ai_scans ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'facture';
-- CHECK constraint for valid doc types
ALTER TABLE vision_ai_scans ADD CONSTRAINT chk_scan_doc_type 
  CHECK (doc_type IN ('facture', 'bl', 'releve'));

-- Add BL-specific denormalized fields
ALTER TABLE vision_ai_scans ADD COLUMN IF NOT EXISTS bl_number TEXT;
-- Add Relevé-specific denormalized fields
ALTER TABLE vision_ai_scans ADD COLUMN IF NOT EXISTS releve_period_start DATE;
ALTER TABLE vision_ai_scans ADD COLUMN IF NOT EXISTS releve_period_end DATE;
```

### Changes to `vision_ai_scan_runs`
```sql
-- Add doc_type column
ALTER TABLE vision_ai_scan_runs ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'facture';

-- Add BL result columns
ALTER TABLE vision_ai_scan_runs ADD COLUMN IF NOT EXISTS result_bl JSONB;
ALTER TABLE vision_ai_scan_runs ADD COLUMN IF NOT EXISTS result_bl_items JSONB;

-- Add Relevé result columns
ALTER TABLE vision_ai_scan_runs ADD COLUMN IF NOT EXISTS result_releve JSONB;
ALTER TABLE vision_ai_scan_runs ADD COLUMN IF NOT EXISTS result_releve_lines JSONB;
ALTER TABLE vision_ai_scan_runs ADD COLUMN IF NOT EXISTS result_reconciliation JSONB;
```

### Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_scans_doc_type ON vision_ai_scans (doc_type, establishment_id);
CREATE INDEX IF NOT EXISTS idx_scan_runs_doc_type ON vision_ai_scan_runs (doc_type);
```

## Service: `src/modules/visionAI/services/scanHistoryService.ts`
Update functions to accept and store `doc_type`:

- `createScan()` — add optional `doc_type` param (default `"facture"`), add `bl_number`, `releve_period_start`, `releve_period_end`
- `recordScanRun()` — add `doc_type`, `result_bl`, `result_bl_items`, `result_releve`, `result_releve_lines`, `result_reconciliation`
- `fetchScans()` — add optional `doc_type` filter
- Keep backward compatibility: existing calls without `doc_type` default to `"facture"`

## Types: `src/modules/visionAI/types/scanHistory.ts`
Update types:
```typescript
type ScanDocType = "facture" | "bl" | "releve";

interface ScanDocument {
  // ... existing fields unchanged
  doc_type: ScanDocType;
  bl_number: string | null;
  releve_period_start: string | null;
  releve_period_end: string | null;
}

interface ScanRun {
  // ... existing fields unchanged
  doc_type: ScanDocType;
  result_bl: BLHeader | null;
  result_bl_items: BLItem[] | null;
  result_releve: ReleveHeader | null;
  result_releve_lines: ReleveLine[] | null;
  result_reconciliation: ReconciliationResult | null;
}
```

## UI: Scan History Component
- Show `doc_type` badge in scan history list rows:
  - 📄 Facture (blue)
  - 📦 BL (orange)
  - 📊 Relevé (purple)
- Filter by doc_type (optional dropdown)
- Allow re-scan for all doc types
- For Relevé scans: show reconciliation summary (matched/unmatched count) inline

## Tests
- [ ] Migration applies cleanly on fresh DB
- [ ] Existing Facture scans unaffected (default doc_type = 'facture')
- [ ] New BL scan created with doc_type = 'bl'
- [ ] New Relevé scan created with doc_type = 'releve'
- [ ] BL scan run stores result_bl and result_bl_items
- [ ] Relevé scan run stores result_releve, result_releve_lines, and result_reconciliation
- [ ] Service backward compatible (no doc_type param = 'facture')
- [ ] UI shows correct badge for each doc type
- [ ] Filter works correctly

## Definition of Done
- [ ] Migration file created and tested
- [ ] Service updated with backward compatibility
- [ ] Types updated with all new fields
- [ ] UI shows doc_type badges with color coding
- [ ] Zero regression on existing Facture scan history
