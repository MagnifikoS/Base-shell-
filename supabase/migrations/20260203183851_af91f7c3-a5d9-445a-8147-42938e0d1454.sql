-- Add learning metrics columns to supplier_extraction_profiles
-- These columns track post-validation metrics for continuous improvement

ALTER TABLE public.supplier_extraction_profiles
ADD COLUMN IF NOT EXISTS fields_corrected_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_import_at timestamptz DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_document_source text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_ai_calls_count integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_vision_triggered boolean DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.supplier_extraction_profiles.fields_corrected_count IS 'Cumulative count of manual corrections (header + lines) across all validations';
COMMENT ON COLUMN public.supplier_extraction_profiles.last_import_at IS 'Timestamp of last validated invoice import';
COMMENT ON COLUMN public.supplier_extraction_profiles.last_document_source IS 'Document source of last import: pdf, image, or screenshot';
COMMENT ON COLUMN public.supplier_extraction_profiles.last_ai_calls_count IS 'AI calls count from last extraction';
COMMENT ON COLUMN public.supplier_extraction_profiles.last_vision_triggered IS 'Whether header vision was triggered on last extraction';