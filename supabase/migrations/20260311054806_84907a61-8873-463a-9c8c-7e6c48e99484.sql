
-- ══════════════════════════════════════════════════════════════════
-- Vision AI Scan History — Tables
-- Non-critical logging tables for scan document tracking.
-- No impact on extraction logic.
-- ══════════════════════════════════════════════════════════════════

-- 1. vision_ai_scans: One row per uploaded document
CREATE TABLE public.vision_ai_scans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  original_filename TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'application/pdf',
  file_size_bytes INTEGER,
  storage_path TEXT NOT NULL,
  supplier_name TEXT,
  invoice_number TEXT,
  bl_number TEXT,
  releve_period_start DATE,
  releve_period_end DATE,
  doc_type TEXT NOT NULL DEFAULT 'facture',
  runs_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);

-- 2. vision_ai_scan_runs: One row per extraction attempt on a scan
CREATE TABLE public.vision_ai_scan_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id UUID NOT NULL REFERENCES public.vision_ai_scans(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  model_label TEXT NOT NULL,
  precision_mode TEXT NOT NULL DEFAULT 'claude',
  result_invoice JSONB,
  result_items JSONB,
  result_insights JSONB,
  items_count INTEGER NOT NULL DEFAULT 0,
  insights_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT,
  doc_type TEXT NOT NULL DEFAULT 'facture',
  result_bl JSONB,
  result_bl_items JSONB,
  result_releve JSONB,
  result_releve_lines JSONB,
  result_reconciliation JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);

-- 3. Auto-increment runs_count on parent scan
CREATE OR REPLACE FUNCTION public.increment_scan_runs_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.vision_ai_scans
  SET runs_count = runs_count + 1,
      last_run_at = NEW.created_at
  WHERE id = NEW.scan_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_increment_scan_runs
  AFTER INSERT ON public.vision_ai_scan_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_scan_runs_count();

-- 4. RLS
ALTER TABLE public.vision_ai_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_ai_scan_runs ENABLE ROW LEVEL SECURITY;

-- Scans: users can CRUD their own establishment's scans
CREATE POLICY "Users can view own establishment scans"
  ON public.vision_ai_scans FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Users can insert own scans"
  ON public.vision_ai_scans FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update own scans"
  ON public.vision_ai_scans FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Users can delete own scans"
  ON public.vision_ai_scans FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());

-- Scan runs: access through parent scan ownership
CREATE POLICY "Users can view own scan runs"
  ON public.vision_ai_scan_runs FOR SELECT
  TO authenticated
  USING (scan_id IN (SELECT id FROM public.vision_ai_scans WHERE owner_id = auth.uid()));

CREATE POLICY "Users can insert own scan runs"
  ON public.vision_ai_scan_runs FOR INSERT
  TO authenticated
  WITH CHECK (scan_id IN (SELECT id FROM public.vision_ai_scans WHERE owner_id = auth.uid()));

-- 5. Indexes
CREATE INDEX idx_vision_ai_scans_establishment ON public.vision_ai_scans(establishment_id);
CREATE INDEX idx_vision_ai_scans_owner ON public.vision_ai_scans(owner_id);
CREATE INDEX idx_vision_ai_scan_runs_scan_id ON public.vision_ai_scan_runs(scan_id);
