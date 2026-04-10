-- ═══════════════════════════════════════════════════════════════════════════
-- Vision AI Benchmark Tables
-- Developer/researcher tool for comparing AI extraction models.
-- Admin-only access. Fully independent — drop these tables to remove.
-- ═══════════════════════════════════════════════════════════════════════════

-- bench_pdfs: Captured PDF metadata for benchmarking corpus
CREATE TABLE IF NOT EXISTS bench_pdfs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size_bytes INTEGER,
  supplier_name TEXT,
  invoice_number TEXT,
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- bench_runs: Individual extraction run results
CREATE TABLE IF NOT EXISTS bench_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bench_pdf_id UUID NOT NULL REFERENCES bench_pdfs(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  model_label TEXT NOT NULL,
  prompt_version TEXT DEFAULT 'v1',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('auto-capture', 'manual')),
  duration_ms INTEGER,
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost_usd NUMERIC(10,6),
  result_invoice JSONB,
  result_items JSONB,
  result_insights JSONB,
  items_count INTEGER DEFAULT 0,
  insights_count INTEGER DEFAULT 0,
  raw_ai_content TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- bench_prompts: Versioned prompt templates (phase 2 — UI later, schema now)
CREATE TABLE IF NOT EXISTS bench_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  user_instruction TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_bench_pdfs_establishment ON bench_pdfs(establishment_id);
CREATE INDEX IF NOT EXISTS idx_bench_runs_pdf ON bench_runs(bench_pdf_id);
CREATE INDEX IF NOT EXISTS idx_bench_runs_status ON bench_runs(status);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — Admin-only access for all bench tables
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE bench_pdfs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bench_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bench_prompts ENABLE ROW LEVEL SECURITY;

-- bench_pdfs: admin SELECT + ALL
CREATE POLICY bench_pdfs_select ON bench_pdfs
  FOR SELECT USING (is_admin(auth.uid()));

CREATE POLICY bench_pdfs_insert ON bench_pdfs
  FOR INSERT WITH CHECK (is_admin(auth.uid()));

CREATE POLICY bench_pdfs_update ON bench_pdfs
  FOR UPDATE USING (is_admin(auth.uid()));

CREATE POLICY bench_pdfs_delete ON bench_pdfs
  FOR DELETE USING (is_admin(auth.uid()));

-- bench_runs: admin SELECT + ALL
CREATE POLICY bench_runs_select ON bench_runs
  FOR SELECT USING (is_admin(auth.uid()));

CREATE POLICY bench_runs_insert ON bench_runs
  FOR INSERT WITH CHECK (is_admin(auth.uid()));

CREATE POLICY bench_runs_update ON bench_runs
  FOR UPDATE USING (is_admin(auth.uid()));

CREATE POLICY bench_runs_delete ON bench_runs
  FOR DELETE USING (is_admin(auth.uid()));

-- bench_prompts: admin SELECT + ALL
CREATE POLICY bench_prompts_select ON bench_prompts
  FOR SELECT USING (is_admin(auth.uid()));

CREATE POLICY bench_prompts_insert ON bench_prompts
  FOR INSERT WITH CHECK (is_admin(auth.uid()));

CREATE POLICY bench_prompts_update ON bench_prompts
  FOR UPDATE USING (is_admin(auth.uid()));

CREATE POLICY bench_prompts_delete ON bench_prompts
  FOR DELETE USING (is_admin(auth.uid()));
