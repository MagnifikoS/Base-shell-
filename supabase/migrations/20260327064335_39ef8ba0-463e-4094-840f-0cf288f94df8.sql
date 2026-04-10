-- Phase 1: Add B2B traceability columns to stock_document_lines
-- All columns are nullable (backward compatible, no existing data impacted)

ALTER TABLE public.stock_document_lines
  ADD COLUMN IF NOT EXISTS source_line_id uuid REFERENCES public.commande_lines(id),
  ADD COLUMN IF NOT EXISTS conversion_factor numeric,
  ADD COLUMN IF NOT EXISTS client_unit_id uuid REFERENCES public.measurement_units(id),
  ADD COLUMN IF NOT EXISTS supplier_unit_id uuid REFERENCES public.measurement_units(id);

-- Index for fast lookup: "which stock movements came from this commande line?"
CREATE INDEX IF NOT EXISTS idx_sdl_source_line_id 
  ON public.stock_document_lines(source_line_id) 
  WHERE source_line_id IS NOT NULL;