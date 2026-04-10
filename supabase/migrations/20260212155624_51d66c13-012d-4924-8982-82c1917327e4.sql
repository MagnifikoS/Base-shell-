
-- ============================================================
-- INVENTAIRE V1 — PHASE 1 : STRUCTURE DB LEDGER
-- ============================================================

-- 1. ENUM for document types and statuses
CREATE TYPE public.stock_document_type AS ENUM ('RECEIPT', 'WITHDRAWAL', 'ADJUSTMENT');
CREATE TYPE public.stock_document_status AS ENUM ('DRAFT', 'POSTED', 'VOID');
CREATE TYPE public.stock_event_type AS ENUM ('RECEIPT', 'WITHDRAWAL', 'ADJUSTMENT', 'VOID');

-- ============================================================
-- 2. zone_stock_snapshots — 1 active snapshot per zone
-- ============================================================
CREATE TABLE public.zone_stock_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  storage_zone_id UUID NOT NULL REFERENCES public.storage_zones(id),
  snapshot_version_id UUID NOT NULL REFERENCES public.inventory_sessions(id),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(establishment_id, storage_zone_id)
);

ALTER TABLE public.zone_stock_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view zone snapshots in their establishments"
  ON public.zone_stock_snapshots FOR SELECT
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "Users can manage zone snapshots in their establishments"
  ON public.zone_stock_snapshots FOR ALL
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()))
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- ============================================================
-- 3. stock_documents — Document lifecycle (DRAFT→POSTED→VOID)
-- ============================================================
CREATE TABLE public.stock_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  storage_zone_id UUID NOT NULL REFERENCES public.storage_zones(id),
  supplier_id UUID REFERENCES public.invoice_suppliers(id),
  type public.stock_document_type NOT NULL,
  status public.stock_document_status NOT NULL DEFAULT 'DRAFT',
  idempotency_key TEXT,
  lock_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at TIMESTAMPTZ,
  posted_by UUID,
  voided_at TIMESTAMPTZ,
  voided_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- P0: 1 DRAFT per (zone, type)
CREATE UNIQUE INDEX uq_stock_documents_one_draft_per_zone_type
  ON public.stock_documents (establishment_id, storage_zone_id, type)
  WHERE status = 'DRAFT';

-- Idempotency key uniqueness
CREATE UNIQUE INDEX uq_stock_documents_idempotency
  ON public.stock_documents (establishment_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.stock_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view stock documents in their establishments"
  ON public.stock_documents FOR SELECT
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "Users can insert stock documents in their establishments"
  ON public.stock_documents FOR INSERT
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "Users can update DRAFT stock documents"
  ON public.stock_documents FOR UPDATE
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "Users cannot delete stock documents"
  ON public.stock_documents FOR DELETE
  USING (false);

-- ============================================================
-- 4. stock_document_lines — Editable only in DRAFT
-- ============================================================
CREATE TABLE public.stock_document_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.stock_documents(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  input_payload JSONB,
  delta_quantity_canonical NUMERIC NOT NULL,
  canonical_unit_id UUID NOT NULL REFERENCES public.measurement_units(id),
  canonical_family TEXT NOT NULL,
  canonical_label TEXT,
  context_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(document_id, product_id)
);

ALTER TABLE public.stock_document_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view stock document lines via document"
  ON public.stock_document_lines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.stock_documents sd
    WHERE sd.id = document_id
    AND sd.establishment_id IN (SELECT public.get_user_establishment_ids())
  ));

CREATE POLICY "Users can insert stock document lines for DRAFT documents"
  ON public.stock_document_lines FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.stock_documents sd
    WHERE sd.id = document_id
    AND sd.status = 'DRAFT'
    AND sd.establishment_id IN (SELECT public.get_user_establishment_ids())
  ));

CREATE POLICY "Users can update stock document lines for DRAFT documents"
  ON public.stock_document_lines FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.stock_documents sd
    WHERE sd.id = document_id
    AND sd.status = 'DRAFT'
    AND sd.establishment_id IN (SELECT public.get_user_establishment_ids())
  ));

CREATE POLICY "Users can delete stock document lines for DRAFT documents"
  ON public.stock_document_lines FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.stock_documents sd
    WHERE sd.id = document_id
    AND sd.status = 'DRAFT'
    AND sd.establishment_id IN (SELECT public.get_user_establishment_ids())
  ));

-- ============================================================
-- 5. stock_events — APPEND-ONLY LEDGER (SSOT)
-- ============================================================
CREATE TABLE public.stock_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  storage_zone_id UUID NOT NULL REFERENCES public.storage_zones(id),
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  document_id UUID NOT NULL REFERENCES public.stock_documents(id),
  event_type public.stock_event_type NOT NULL,
  event_reason TEXT NOT NULL,
  delta_quantity_canonical NUMERIC NOT NULL,
  canonical_unit_id UUID NOT NULL REFERENCES public.measurement_units(id),
  canonical_family TEXT NOT NULL,
  canonical_label TEXT,
  context_hash TEXT NOT NULL,
  snapshot_version_id UUID NOT NULL REFERENCES public.inventory_sessions(id),
  override_flag BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by UUID,
  voids_event_id UUID REFERENCES public.stock_events(id),
  voids_document_id UUID REFERENCES public.stock_documents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce: override_reason required when override_flag
CREATE OR REPLACE FUNCTION public.fn_stock_events_validate_override()
  RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.override_flag = true AND (NEW.override_reason IS NULL OR NEW.override_reason = '') THEN
    RAISE EXCEPTION 'override_reason is required when override_flag is true';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stock_events_validate_override
  BEFORE INSERT ON public.stock_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_stock_events_validate_override();

-- Prevent UPDATE/DELETE on stock_events (append-only)
CREATE OR REPLACE FUNCTION public.fn_stock_events_immutable()
  RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'stock_events is append-only: UPDATE and DELETE are forbidden';
END;
$$;

CREATE TRIGGER trg_stock_events_no_update
  BEFORE UPDATE ON public.stock_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_stock_events_immutable();

CREATE TRIGGER trg_stock_events_no_delete
  BEFORE DELETE ON public.stock_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_stock_events_immutable();

ALTER TABLE public.stock_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view stock events in their establishments"
  ON public.stock_events FOR SELECT
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "Users can insert stock events in their establishments"
  ON public.stock_events FOR INSERT
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- ============================================================
-- 6. INDEXES — Performance
-- ============================================================
CREATE INDEX idx_stock_events_product_zone_posted
  ON public.stock_events (product_id, storage_zone_id, posted_at);

CREATE INDEX idx_stock_events_snapshot_version
  ON public.stock_events (snapshot_version_id);

CREATE INDEX idx_stock_events_document
  ON public.stock_events (document_id);

CREATE INDEX idx_stock_documents_zone_status
  ON public.stock_documents (storage_zone_id, status);

-- ============================================================
-- 7. Triggers: updated_at on new tables
-- ============================================================
CREATE TRIGGER update_zone_stock_snapshots_updated_at
  BEFORE UPDATE ON public.zone_stock_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_stock_documents_updated_at
  BEFORE UPDATE ON public.stock_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_stock_document_lines_updated_at
  BEFORE UPDATE ON public.stock_document_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 8. Migration init: populate zone_stock_snapshots
--    Pour chaque zone ayant au moins 1 session terminée,
--    pointer vers la dernière session terminée (enum: 'termine').
-- ============================================================
INSERT INTO public.zone_stock_snapshots (establishment_id, organization_id, storage_zone_id, snapshot_version_id)
SELECT DISTINCT ON (s.storage_zone_id)
  s.establishment_id,
  s.organization_id,
  s.storage_zone_id,
  s.id AS snapshot_version_id
FROM public.inventory_sessions s
WHERE s.status = 'termine'
ORDER BY s.storage_zone_id, s.completed_at DESC NULLS LAST, s.id DESC;
