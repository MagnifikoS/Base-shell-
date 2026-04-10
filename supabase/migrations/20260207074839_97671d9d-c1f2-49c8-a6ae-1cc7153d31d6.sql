-- ═══════════════════════════════════════════════════════════════════════════
-- PRODUCTS V2 TABLE — Isolated from V1, fully independent
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Create products_v2 table
CREATE TABLE public.products_v2 (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  
  -- Identification
  code_produit TEXT,
  code_barres TEXT,
  nom_produit TEXT NOT NULL,
  nom_produit_fr TEXT,
  name_normalized TEXT NOT NULL,
  variant_format TEXT,
  
  -- Categorization & Supplier
  category TEXT,
  supplier_name TEXT,
  
  -- Conditioning (from V2 engine)
  conditionnement_config JSONB DEFAULT '{}',
  conditionnement_resume TEXT,
  
  -- Final pricing
  final_unit_price NUMERIC(12, 4),
  final_unit TEXT,
  
  -- Additional info
  info_produit TEXT,
  
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  created_by UUID,
  
  -- Constraints
  CONSTRAINT products_v2_name_normalized_not_empty CHECK (name_normalized != '')
);

-- 2) Unique indexes for anti-duplicate protection
CREATE UNIQUE INDEX idx_products_v2_establishment_barcode 
ON public.products_v2 (establishment_id, code_barres) 
WHERE code_barres IS NOT NULL AND archived_at IS NULL;

CREATE UNIQUE INDEX idx_products_v2_establishment_code_produit 
ON public.products_v2 (establishment_id, code_produit) 
WHERE code_produit IS NOT NULL AND archived_at IS NULL;

CREATE UNIQUE INDEX idx_products_v2_establishment_name_normalized 
ON public.products_v2 (establishment_id, name_normalized) 
WHERE archived_at IS NULL;

-- 3) Performance indexes
CREATE INDEX idx_products_v2_establishment ON public.products_v2 (establishment_id) WHERE archived_at IS NULL;
CREATE INDEX idx_products_v2_category ON public.products_v2 (establishment_id, category) WHERE archived_at IS NULL;
CREATE INDEX idx_products_v2_supplier ON public.products_v2 (establishment_id, supplier_name) WHERE archived_at IS NULL;
CREATE INDEX idx_products_v2_search ON public.products_v2 USING GIN (
  to_tsvector('simple', coalesce(nom_produit, '') || ' ' || coalesce(code_produit, '') || ' ' || coalesce(code_barres, ''))
) WHERE archived_at IS NULL;

-- 4) Updated_at trigger
CREATE TRIGGER update_products_v2_updated_at
BEFORE UPDATE ON public.products_v2
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Enable RLS
ALTER TABLE public.products_v2 ENABLE ROW LEVEL SECURITY;

-- 6) RLS Policies (establishment-scoped)
CREATE POLICY "Users can view products_v2 in their establishments"
ON public.products_v2 FOR SELECT
USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "Users can insert products_v2 in their establishments"
ON public.products_v2 FOR INSERT
WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "Users can update products_v2 in their establishments"
ON public.products_v2 FOR UPDATE
USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "Users can delete products_v2 in their establishments"
ON public.products_v2 FOR DELETE
USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- 7) Add module key for RBAC (reuses same key as V1 for now)
INSERT INTO public.modules (key, name, display_order)
VALUES ('produits_v2', 'Produits V2', 106)
ON CONFLICT (key) DO NOTHING;