-- ═══════════════════════════════════════════════════════════════════════════
-- BL-01: BL Correction Chain Integrity Enforcement
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Findings:
--   1. corrects_document_id has no CHECK ensuring target is a RECEIPT
--   2. No check that the target document is POSTED
--   3. No depth limit: RECEIPT_CORRECTION can reference another RECEIPT_CORRECTION
--   4. corrections_count is maintained client-side (TOCTOU)
--
-- Fixes:
--   A. Trigger to enforce correction target must be type=RECEIPT and status=POSTED
--   B. Trigger to auto-maintain corrections_count atomically
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- A. Trigger: validate corrects_document_id target on INSERT/UPDATE
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_validate_correction_target()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target RECORD;
BEGIN
  -- Only check when corrects_document_id is set
  IF NEW.corrects_document_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch the target document
  SELECT type, status INTO v_target
  FROM stock_documents
  WHERE id = NEW.corrects_document_id;

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'CORRECTION_TARGET_NOT_FOUND: document % does not exist', NEW.corrects_document_id;
  END IF;

  -- Target must be a RECEIPT (not another correction, withdrawal, etc.)
  IF v_target.type != 'RECEIPT' THEN
    RAISE EXCEPTION 'CORRECTION_TARGET_NOT_RECEIPT: document % has type %, expected RECEIPT',
      NEW.corrects_document_id, v_target.type;
  END IF;

  -- Target must be POSTED (not DRAFT or VOID)
  IF v_target.status != 'POSTED' THEN
    RAISE EXCEPTION 'CORRECTION_TARGET_NOT_POSTED: document % has status %, expected POSTED',
      NEW.corrects_document_id, v_target.status;
  END IF;

  RETURN NEW;
END;
$$;

-- Apply trigger on stock_documents INSERT and UPDATE of corrects_document_id
DROP TRIGGER IF EXISTS trg_validate_correction_target ON public.stock_documents;
CREATE TRIGGER trg_validate_correction_target
  BEFORE INSERT OR UPDATE OF corrects_document_id
  ON public.stock_documents
  FOR EACH ROW
  WHEN (NEW.corrects_document_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_validate_correction_target();

-- ─────────────────────────────────────────────────────────────────────────
-- B. Trigger: auto-maintain bl_app_documents.corrections_count
--    Fires when a stock_document with corrects_document_id changes status
--    to/from POSTED. This replaces the client-side TOCTOU pattern.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_maintain_corrections_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_original_doc_id UUID;
  v_count INT;
BEGIN
  -- Determine the original document being corrected
  v_original_doc_id := COALESCE(NEW.corrects_document_id, OLD.corrects_document_id);

  -- Only care about RECEIPT_CORRECTION documents
  IF v_original_doc_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count POSTED corrections for this original document
  SELECT COUNT(*) INTO v_count
  FROM stock_documents
  WHERE corrects_document_id = v_original_doc_id
    AND status = 'POSTED';

  -- Update all bl_app_documents linked to this stock document
  UPDATE bl_app_documents
  SET corrections_count = v_count
  WHERE stock_document_id = v_original_doc_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maintain_corrections_count ON public.stock_documents;
CREATE TRIGGER trg_maintain_corrections_count
  AFTER INSERT OR UPDATE OF status
  ON public.stock_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_maintain_corrections_count();
