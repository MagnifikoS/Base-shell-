-- ═══════════════════════════════════════════════════════════════════════════
-- VISION IA V2 — Storage Tables + RLS + TTL
-- ═══════════════════════════════════════════════════════════════════════════
-- MODULE 100% ISOLÉ: Pas de FK vers tables métier
-- owner_id = auth.uid() strict
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Table des documents (metadata)
CREATE TABLE public.vision_ia_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  storage_path TEXT, -- chemin dans le bucket (null si pas uploadé)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error_message TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Table des graphs (JSON extrait)
CREATE TABLE public.vision_ia_graphs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.vision_ia_documents(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  graph_json JSONB NOT NULL,
  schema_version TEXT NOT NULL DEFAULT 'dug_v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Index pour les requêtes courantes
CREATE INDEX idx_vision_ia_documents_owner ON public.vision_ia_documents(owner_id);
CREATE INDEX idx_vision_ia_documents_expires ON public.vision_ia_documents(expires_at);
CREATE INDEX idx_vision_ia_graphs_document ON public.vision_ia_graphs(document_id);
CREATE INDEX idx_vision_ia_graphs_owner ON public.vision_ia_graphs(owner_id);

-- 4. Trigger updated_at
CREATE TRIGGER update_vision_ia_documents_updated_at
  BEFORE UPDATE ON public.vision_ia_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — STRICT OWNER ONLY
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vision_ia_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_ia_graphs ENABLE ROW LEVEL SECURITY;

-- Documents: owner only
CREATE POLICY "vision_ia_documents_select_owner" ON public.vision_ia_documents
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "vision_ia_documents_insert_owner" ON public.vision_ia_documents
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "vision_ia_documents_update_owner" ON public.vision_ia_documents
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "vision_ia_documents_delete_owner" ON public.vision_ia_documents
  FOR DELETE USING (auth.uid() = owner_id);

-- Graphs: owner only
CREATE POLICY "vision_ia_graphs_select_owner" ON public.vision_ia_graphs
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "vision_ia_graphs_insert_owner" ON public.vision_ia_graphs
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "vision_ia_graphs_delete_owner" ON public.vision_ia_graphs
  FOR DELETE USING (auth.uid() = owner_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- STORAGE BUCKET RLS — vision-ia-documents
-- ═══════════════════════════════════════════════════════════════════════════
-- Bucket déjà créé (is_public: false), on ajoute les policies

-- Policy SELECT: owner only (path = uid/...)
CREATE POLICY "vision_ia_storage_select_owner" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'vision-ia-documents' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Policy INSERT: owner only
CREATE POLICY "vision_ia_storage_insert_owner" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'vision-ia-documents' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Policy UPDATE: owner only
CREATE POLICY "vision_ia_storage_update_owner" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'vision-ia-documents' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Policy DELETE: owner only
CREATE POLICY "vision_ia_storage_delete_owner" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'vision-ia-documents' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );