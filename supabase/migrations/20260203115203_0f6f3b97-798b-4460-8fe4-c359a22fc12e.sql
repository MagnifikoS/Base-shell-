-- ============================================================
-- PHASE 1.1: Create products table (SSOT globale)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  name_normalized text NOT NULL,
  category text NULL,
  unit_of_sale text NULL,
  barcode text NULL,
  brand text NULL,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one normalized name per establishment
ALTER TABLE public.products 
  ADD CONSTRAINT products_establishment_name_unique 
  UNIQUE (establishment_id, name_normalized);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_products_establishment_archived 
  ON public.products(establishment_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_products_establishment_name 
  ON public.products(establishment_id, name_normalized);

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- RLS Policies (same pattern as factures tables)
CREATE POLICY "products_select" ON public.products
  FOR SELECT USING (has_module_access('factures', 'read', establishment_id));

CREATE POLICY "products_insert" ON public.products
  FOR INSERT WITH CHECK (has_module_access('factures', 'write', establishment_id));

CREATE POLICY "products_update" ON public.products
  FOR UPDATE USING (has_module_access('factures', 'write', establishment_id));

CREATE POLICY "products_delete" ON public.products
  FOR DELETE USING (has_module_access('factures', 'write', establishment_id));

-- Trigger for updated_at
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- PHASE 1.2: Add bridge column to supplier_extracted_products
-- ============================================================

ALTER TABLE public.supplier_extracted_products 
  ADD COLUMN IF NOT EXISTS global_product_id uuid NULL 
  REFERENCES products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sep_global_product 
  ON public.supplier_extracted_products(establishment_id, global_product_id);

-- ============================================================
-- PHASE 1.3: Extend supplier_product_aliases (reuse, no new table)
-- ============================================================

-- Add global_product_id column (new SSOT reference)
ALTER TABLE public.supplier_product_aliases 
  ADD COLUMN IF NOT EXISTS global_product_id uuid NULL 
  REFERENCES products(id) ON DELETE SET NULL;

-- Add supplier-side product info columns
ALTER TABLE public.supplier_product_aliases 
  ADD COLUMN IF NOT EXISTS supplier_product_code text NULL;

ALTER TABLE public.supplier_product_aliases 
  ADD COLUMN IF NOT EXISTS supplier_product_name text NULL;

ALTER TABLE public.supplier_product_aliases 
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NULL;

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_spa_supplier_code 
  ON public.supplier_product_aliases(establishment_id, supplier_id, supplier_product_code)
  WHERE supplier_product_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spa_global_product 
  ON public.supplier_product_aliases(establishment_id, supplier_id, global_product_id);

-- ============================================================
-- DOCUMENTATION: Column semantics for future migration
-- ============================================================
-- supplier_product_aliases.product_id = legacy FK to supplier_extracted_products.id
-- supplier_product_aliases.global_product_id = new FK to products.id (SSOT)
-- In Phase 2+, we will migrate FK and deprecate product_id
-- ============================================================