-- Add reference_run_id to bench_pdfs
-- Any successful run can be marked as the "reference" for scoring other runs.
ALTER TABLE bench_pdfs
  ADD COLUMN reference_run_id UUID REFERENCES bench_runs(id) ON DELETE SET NULL;
