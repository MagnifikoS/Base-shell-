-- ============================================
-- Table: supplier_product_category_hints
-- Purpose: Learning loop for category suggestions
-- ============================================

CREATE TABLE IF NOT EXISTS public.supplier_product_category_hints (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.invoice_suppliers(id) ON DELETE CASCADE,
  normalized_key TEXT NOT NULL,
  category TEXT NOT NULL,
  confidence_source TEXT NOT NULL DEFAULT 'user' CHECK (confidence_source IN ('user', 'validated_invoice', 'ai_confirmed')),
  hit_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Unique constraint: one category per normalized_key per supplier per establishment
  CONSTRAINT uq_category_hint UNIQUE (establishment_id, supplier_id, normalized_key)
);

-- Partial index for global hints (NULL supplier)
CREATE INDEX IF NOT EXISTS idx_category_hints_global 
  ON public.supplier_product_category_hints(establishment_id, normalized_key) 
  WHERE supplier_id IS NULL;

-- Index for supplier-specific hints
CREATE INDEX IF NOT EXISTS idx_category_hints_supplier 
  ON public.supplier_product_category_hints(establishment_id, supplier_id, normalized_key) 
  WHERE supplier_id IS NOT NULL;

-- Enable RLS
ALTER TABLE public.supplier_product_category_hints ENABLE ROW LEVEL SECURITY;

-- RLS Policies (same as factures/products module)
CREATE POLICY "Users can view their establishment's category hints"
  ON public.supplier_product_category_hints
  FOR SELECT
  USING (
    establishment_id IN (SELECT public.get_user_establishment_ids())
  );

CREATE POLICY "Users can insert category hints for their establishments"
  ON public.supplier_product_category_hints
  FOR INSERT
  WITH CHECK (
    establishment_id IN (SELECT public.get_user_establishment_ids())
  );

CREATE POLICY "Users can update their establishment's category hints"
  ON public.supplier_product_category_hints
  FOR UPDATE
  USING (
    establishment_id IN (SELECT public.get_user_establishment_ids())
  );

CREATE POLICY "Users can delete their establishment's category hints"
  ON public.supplier_product_category_hints
  FOR DELETE
  USING (
    establishment_id IN (SELECT public.get_user_establishment_ids())
  );

-- Comment for documentation
COMMENT ON TABLE public.supplier_product_category_hints IS 'Learning table for product category suggestions. Stores user-confirmed categories to improve future AI suggestions.';