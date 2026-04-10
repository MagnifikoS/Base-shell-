-- ═══════════════════════════════════════════════════════════════════════════
-- PURCHASE LINE ITEMS — SSOT Achat (Module isolé, supprimable)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.purchase_line_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Foreign keys
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL,
  supplier_id UUID NOT NULL,
  product_id UUID REFERENCES public.products_v2(id) ON DELETE SET NULL,
  
  -- Temporal grouping (SSOT: derived from invoice_date)
  year_month TEXT NOT NULL,
  
  -- Line identification (stable within SAS session)
  source_line_id TEXT NOT NULL,
  
  -- SSOT quantities (raw, no conversion)
  quantite_commandee NUMERIC NULL,
  line_total NUMERIC NULL,
  
  -- Snapshots (informatif, pas SSOT pour calculs)
  product_code_snapshot TEXT NULL,
  product_name_snapshot TEXT NULL,
  unit_snapshot TEXT NULL,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- CONSTRAINTS
-- ═══════════════════════════════════════════════════════════════════════════

-- Unicité par facture + ligne source
ALTER TABLE public.purchase_line_items
  ADD CONSTRAINT purchase_line_items_invoice_source_unique 
  UNIQUE (invoice_id, source_line_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- INDEXES (zero-latency queries)
-- ═══════════════════════════════════════════════════════════════════════════

-- Récap mensuel par établissement
CREATE INDEX idx_purchase_line_items_establishment_month 
  ON public.purchase_line_items (establishment_id, year_month);

-- Récap par produit et mois
CREATE INDEX idx_purchase_line_items_product_month 
  ON public.purchase_line_items (product_id, year_month) 
  WHERE product_id IS NOT NULL;

-- Récap par fournisseur et mois
CREATE INDEX idx_purchase_line_items_supplier_month 
  ON public.purchase_line_items (supplier_id, year_month);

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.purchase_line_items ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can view purchase lines in their establishments
CREATE POLICY "Users can view purchase_line_items in their establishments"
  ON public.purchase_line_items
  FOR SELECT
  USING (
    has_module_access('factures'::text, 'read'::access_level, establishment_id)
  );

-- INSERT: Users can create purchase lines in their establishments
CREATE POLICY "Users can create purchase_line_items in their establishments"
  ON public.purchase_line_items
  FOR INSERT
  WITH CHECK (
    has_module_access('factures'::text, 'write'::access_level, establishment_id)
  );

-- UPDATE: Users can update purchase lines in their establishments
CREATE POLICY "Users can update purchase_line_items in their establishments"
  ON public.purchase_line_items
  FOR UPDATE
  USING (
    has_module_access('factures'::text, 'write'::access_level, establishment_id)
  );

-- DELETE: Users can delete purchase lines in their establishments
CREATE POLICY "Users can delete purchase_line_items in their establishments"
  ON public.purchase_line_items
  FOR DELETE
  USING (
    has_module_access('factures'::text, 'write'::access_level, establishment_id)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- COMMENTS
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE public.purchase_line_items IS 'SSOT Achat — Lignes d''achat persistées après validation Vision AI. Module isolé et supprimable.';
COMMENT ON COLUMN public.purchase_line_items.quantite_commandee IS 'Quantité brute facturée (SSOT). NULL si absente. Jamais de conversion.';
COMMENT ON COLUMN public.purchase_line_items.unit_snapshot IS 'Unité extraite par IA (informatif uniquement). SSOT unité = products_v2.supplier_billing_unit';
COMMENT ON COLUMN public.purchase_line_items.source_line_id IS 'Identifiant UI de la ligne (_id). Stable pendant la session SAS.';