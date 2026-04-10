
-- ═══════════════════════════════════════════════════════════════════════════
-- MODULE BL-APP — ÉTAPE 1 : Tables + RLS + Bucket (ADDITIF PUR)
-- Aucune modification de table existante. Supprimable sans effet de bord.
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════ 1. bl_app_documents ══════════════
CREATE TABLE public.bl_app_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  stock_document_id UUID NOT NULL UNIQUE REFERENCES public.stock_documents(id) ON DELETE RESTRICT,
  supplier_id UUID NULL REFERENCES public.invoice_suppliers(id),
  supplier_name_snapshot TEXT NULL,
  bl_number TEXT NULL,
  bl_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'FINAL')),
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_bl_app_documents_est_date ON public.bl_app_documents (establishment_id, bl_date);
CREATE INDEX idx_bl_app_documents_supplier_date ON public.bl_app_documents (supplier_id, bl_date);

ALTER TABLE public.bl_app_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bl_app_documents_select"
  ON public.bl_app_documents FOR SELECT
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "bl_app_documents_insert"
  ON public.bl_app_documents FOR INSERT
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "bl_app_documents_update"
  ON public.bl_app_documents FOR UPDATE
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- Trigger updated_at
CREATE TRIGGER update_bl_app_documents_updated_at
  BEFORE UPDATE ON public.bl_app_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ══════════════ 2. bl_app_lines ══════════════
CREATE TABLE public.bl_app_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  bl_app_document_id UUID NOT NULL REFERENCES public.bl_app_documents(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  quantity_canonical NUMERIC NOT NULL,
  canonical_unit_id UUID NOT NULL REFERENCES public.measurement_units(id),
  context_hash TEXT NULL,
  unit_price NUMERIC NULL,
  line_total NUMERIC NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bl_app_lines_document ON public.bl_app_lines (bl_app_document_id);

ALTER TABLE public.bl_app_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bl_app_lines_select"
  ON public.bl_app_lines FOR SELECT
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "bl_app_lines_insert"
  ON public.bl_app_lines FOR INSERT
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "bl_app_lines_update"
  ON public.bl_app_lines FOR UPDATE
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- ══════════════ 3. bl_app_files ══════════════
CREATE TABLE public.bl_app_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  bl_app_document_id UUID NOT NULL REFERENCES public.bl_app_documents(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  mime_type TEXT NULL,
  original_name TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bl_app_files_document ON public.bl_app_files (bl_app_document_id);

ALTER TABLE public.bl_app_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bl_app_files_select"
  ON public.bl_app_files FOR SELECT
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "bl_app_files_insert"
  ON public.bl_app_files FOR INSERT
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- ══════════════ 4. Storage bucket bl_app ══════════════
INSERT INTO storage.buckets (id, name, public) VALUES ('bl_app', 'bl_app', false);

-- Storage RLS: read for users in same establishment
CREATE POLICY "bl_app_storage_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'bl_app'
    AND (storage.foldername(name))[1] = 'establishments'
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.establishments
      WHERE id IN (SELECT public.get_user_establishment_ids())
    )
  );

-- Storage RLS: upload for users in same establishment
CREATE POLICY "bl_app_storage_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'bl_app'
    AND (storage.foldername(name))[1] = 'establishments'
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.establishments
      WHERE id IN (SELECT public.get_user_establishment_ids())
    )
  );
