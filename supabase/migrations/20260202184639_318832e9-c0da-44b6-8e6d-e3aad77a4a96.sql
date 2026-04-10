-- ===================================================
-- Migration: supplier_product_aliases (Alias Learning)
-- ===================================================
-- This table enables "continuous learning" for product matching
-- without retraining the AI. When a user manually links an extracted
-- product to an existing product during review, we store this as an alias.
-- On future imports, we check aliases FIRST for instant matching.
-- ===================================================

-- Create supplier_product_aliases table
CREATE TABLE public.supplier_product_aliases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.invoice_suppliers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.supplier_extracted_products(id) ON DELETE CASCADE,
  -- Normalized key for matching (derived from extracted raw_label or product_name)
  normalized_key TEXT NOT NULL,
  -- Sample of raw label for debugging/trace
  raw_label_sample TEXT NULL,
  -- Source of confidence (human_validation = user selected, auto = exact match)
  confidence_source TEXT NOT NULL DEFAULT 'human_validation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one alias per normalized_key per supplier/establishment
CREATE UNIQUE INDEX idx_supplier_product_aliases_unique_key 
ON public.supplier_product_aliases(establishment_id, supplier_id, normalized_key);

-- Index for fast lookup by product_id
CREATE INDEX idx_supplier_product_aliases_product 
ON public.supplier_product_aliases(establishment_id, supplier_id, product_id);

-- Enable RLS
ALTER TABLE public.supplier_product_aliases ENABLE ROW LEVEL SECURITY;

-- RLS Policies (scoped by establishment_id, same pattern as other tables)
CREATE POLICY "Users can view aliases for their establishments"
ON public.supplier_product_aliases
FOR SELECT
USING (
  establishment_id IN (
    SELECT establishment_id FROM public.user_establishments 
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert aliases for their establishments"
ON public.supplier_product_aliases
FOR INSERT
WITH CHECK (
  establishment_id IN (
    SELECT establishment_id FROM public.user_establishments 
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can update aliases for their establishments"
ON public.supplier_product_aliases
FOR UPDATE
USING (
  establishment_id IN (
    SELECT establishment_id FROM public.user_establishments 
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete aliases for their establishments"
ON public.supplier_product_aliases
FOR DELETE
USING (
  establishment_id IN (
    SELECT establishment_id FROM public.user_establishments 
    WHERE user_id = auth.uid()
  )
);

-- Comment for documentation
COMMENT ON TABLE public.supplier_product_aliases IS 
'Stores learned product aliases for improved matching. When a user manually links an extracted product to an existing product, we store the normalized key here. Future imports check this table first for instant matching (LOCK 1 respected: writes only at validation time).';