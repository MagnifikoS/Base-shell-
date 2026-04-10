-- ═══════════════════════════════════════════════════════════════════════════
-- Vision AI Scan History — Persistent document + extraction tracking
-- ═══════════════════════════════════════════════════════════════════════════

-- Table: vision_ai_scans — One row per uploaded document
CREATE TABLE IF NOT EXISTS vision_ai_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'application/pdf',
  file_size_bytes INTEGER,
  storage_path TEXT NOT NULL,
  -- Denormalized from latest run (avoid N+1 queries)
  supplier_name TEXT,
  invoice_number TEXT,
  -- Run stats (trigger-updated)
  runs_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Table: vision_ai_scan_runs — One row per extraction attempt
CREATE TABLE IF NOT EXISTS vision_ai_scan_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES vision_ai_scans(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  model_label TEXT NOT NULL,
  precision_mode TEXT NOT NULL DEFAULT 'standard',
  -- Extraction results as JSONB
  result_invoice JSONB,
  result_items JSONB,
  result_insights JSONB,
  -- Stats
  items_count INTEGER NOT NULL DEFAULT 0,
  insights_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  -- Status
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error')),
  error_message TEXT,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vision_ai_scans_establishment
  ON vision_ai_scans(establishment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vision_ai_scans_owner
  ON vision_ai_scans(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vision_ai_scan_runs_scan
  ON vision_ai_scan_runs(scan_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Trigger: Auto-update runs_count and last_run_at on parent scan
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_scan_run_stats()
RETURNS TRIGGER AS $$
DECLARE
  target_scan_id UUID;
BEGIN
  -- Determine which scan_id to update
  IF TG_OP = 'DELETE' THEN
    target_scan_id := OLD.scan_id;
  ELSE
    target_scan_id := NEW.scan_id;
  END IF;

  UPDATE vision_ai_scans
  SET
    runs_count = (SELECT COUNT(*) FROM vision_ai_scan_runs WHERE scan_id = target_scan_id),
    last_run_at = (SELECT MAX(created_at) FROM vision_ai_scan_runs WHERE scan_id = target_scan_id)
  WHERE id = target_scan_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_scan_run_stats ON vision_ai_scan_runs;
CREATE TRIGGER trg_scan_run_stats
  AFTER INSERT OR UPDATE OR DELETE ON vision_ai_scan_runs
  FOR EACH ROW EXECUTE FUNCTION update_scan_run_stats();

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS Policies
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE vision_ai_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE vision_ai_scan_runs ENABLE ROW LEVEL SECURITY;

-- Scans: owner can CRUD their own, admin can read all in establishment
DROP POLICY IF EXISTS "scan_owner_select" ON vision_ai_scans;
CREATE POLICY "scan_owner_select" ON vision_ai_scans
  FOR SELECT USING (
    auth.uid() = owner_id
    OR is_admin(auth.uid())
  );

DROP POLICY IF EXISTS "scan_owner_insert" ON vision_ai_scans;
CREATE POLICY "scan_owner_insert" ON vision_ai_scans
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "scan_owner_delete" ON vision_ai_scans;
CREATE POLICY "scan_owner_delete" ON vision_ai_scans
  FOR DELETE USING (
    auth.uid() = owner_id
    OR is_admin(auth.uid())
  );

-- Scan runs: read via parent scan, write for authenticated users
DROP POLICY IF EXISTS "scan_run_select" ON vision_ai_scan_runs;
CREATE POLICY "scan_run_select" ON vision_ai_scan_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vision_ai_scans
      WHERE id = vision_ai_scan_runs.scan_id
        AND (owner_id = auth.uid() OR is_admin(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "scan_run_insert" ON vision_ai_scan_runs;
CREATE POLICY "scan_run_insert" ON vision_ai_scan_runs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM vision_ai_scans
      WHERE id = vision_ai_scan_runs.scan_id
        AND (owner_id = auth.uid() OR is_admin(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "scan_run_delete" ON vision_ai_scan_runs;
CREATE POLICY "scan_run_delete" ON vision_ai_scan_runs
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM vision_ai_scans
      WHERE id = vision_ai_scan_runs.scan_id
        AND (owner_id = auth.uid() OR is_admin(auth.uid()))
    )
  );
