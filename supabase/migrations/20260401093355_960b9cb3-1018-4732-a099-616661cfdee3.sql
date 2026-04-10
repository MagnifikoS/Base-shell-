
-- ═══════════════════════════════════════════════════════════════════
-- RESET STOCK: Purge all stock data for NONNA SECRET (pre-production)
-- ═══════════════════════════════════════════════════════════════════

-- 0. Disable ALL protection triggers on stock_events
ALTER TABLE public.stock_events DISABLE TRIGGER trg_stock_events_no_delete;
ALTER TABLE public.stock_events DISABLE TRIGGER trg_stock_events_no_update;
ALTER TABLE public.stock_events DISABLE TRIGGER trg_guard_stock_event_unit_ownership;
ALTER TABLE public.stock_events DISABLE TRIGGER trg_stock_events_validate_family;
ALTER TABLE public.stock_events DISABLE TRIGGER trg_stock_events_validate_override;

-- 1. BL App: lines, files, documents
DELETE FROM public.bl_app_lines WHERE bl_app_document_id IN (
  SELECT id FROM public.bl_app_documents WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000'
);
DELETE FROM public.bl_app_files WHERE bl_app_document_id IN (
  SELECT id FROM public.bl_app_documents WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000'
);
DELETE FROM public.bl_app_documents WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000';

-- 2. BL Withdrawal: lines, documents
DELETE FROM public.bl_withdrawal_lines WHERE bl_withdrawal_document_id IN (
  SELECT id FROM public.bl_withdrawal_documents WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000'
);
DELETE FROM public.bl_withdrawal_documents WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000';

-- 3. Clear voids_document_id FK on stock_events
UPDATE public.stock_events SET voids_document_id = NULL
WHERE voids_document_id IN (
  SELECT id FROM public.stock_documents WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000'
);

-- 4. Delete ALL stock_events referencing Nonna products OR Nonna documents
DELETE FROM public.stock_events
WHERE product_id IN (
  SELECT id FROM public.products_v2 WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000'
)
OR document_id IN (
  SELECT id FROM public.stock_documents WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000'
);

-- 5. Clear self-ref corrects_document_id
UPDATE public.stock_documents SET corrects_document_id = NULL
WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000';

-- 6. Stock document lines + documents
DELETE FROM public.stock_document_lines WHERE document_id IN (
  SELECT id FROM public.stock_documents WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000'
);
DELETE FROM public.stock_documents WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000';

-- 7. Monthly snapshots
DELETE FROM public.stock_monthly_snapshot_lines WHERE snapshot_id IN (
  SELECT id FROM public.stock_monthly_snapshots WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000'
);
DELETE FROM public.stock_monthly_snapshots WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000';

-- 8. Re-enable ALL triggers
ALTER TABLE public.stock_events ENABLE TRIGGER trg_stock_events_no_delete;
ALTER TABLE public.stock_events ENABLE TRIGGER trg_stock_events_no_update;
ALTER TABLE public.stock_events ENABLE TRIGGER trg_guard_stock_event_unit_ownership;
ALTER TABLE public.stock_events ENABLE TRIGGER trg_stock_events_validate_family;
ALTER TABLE public.stock_events ENABLE TRIGGER trg_stock_events_validate_override;
