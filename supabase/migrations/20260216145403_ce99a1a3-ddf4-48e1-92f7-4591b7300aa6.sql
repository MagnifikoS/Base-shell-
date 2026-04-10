
-- ═══════════════════════════════════════════════════════════════════════════
-- RECEIPT_CORRECTION — Schema additions for append-only BL corrections
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add RECEIPT_CORRECTION to stock_document_type enum
ALTER TYPE public.stock_document_type ADD VALUE IF NOT EXISTS 'RECEIPT_CORRECTION';

-- 2. Add RECEIPT_CORRECTION to stock_event_type enum
ALTER TYPE public.stock_event_type ADD VALUE IF NOT EXISTS 'RECEIPT_CORRECTION';

-- 3. Add corrects_document_id column to stock_documents (self-FK to original RECEIPT)
ALTER TABLE public.stock_documents
  ADD COLUMN IF NOT EXISTS corrects_document_id UUID REFERENCES public.stock_documents(id);

-- 4. Add corrections_count to bl_app_documents for UI badge display
ALTER TABLE public.bl_app_documents
  ADD COLUMN IF NOT EXISTS corrections_count INT NOT NULL DEFAULT 0;

-- 5. Index for fast lookup of corrections by original document
CREATE INDEX IF NOT EXISTS idx_stock_documents_corrects_document_id
  ON public.stock_documents(corrects_document_id)
  WHERE corrects_document_id IS NOT NULL;
