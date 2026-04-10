-- ============================================================
-- PHASE 2.1: invoice_line_items independence (snapshots + global FK)
-- ============================================================

-- A) Add snapshot columns to invoice_line_items
ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS global_product_id uuid NULL REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_product_id_legacy uuid NULL,
  ADD COLUMN IF NOT EXISTS product_name_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS product_code_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS category_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS unit_of_sale_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS unit_price_snapshot numeric NULL,
  ADD COLUMN IF NOT EXISTS packaging_snapshot text NULL;

-- B) Indexes for performance
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_global_product 
  ON public.invoice_line_items(establishment_id, global_product_id);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice 
  ON public.invoice_line_items(establishment_id, invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_year_month 
  ON public.invoice_line_items(establishment_id, year_month);

-- ============================================================
-- PHASE 2.1 (cont): Add archived_at to supplier tables
-- ============================================================

-- supplier_extracted_products: add archived_at
ALTER TABLE public.supplier_extracted_products
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

-- invoice_suppliers: add archived_at  
ALTER TABLE public.invoice_suppliers
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

-- supplier_product_aliases: add archived_at
ALTER TABLE public.supplier_product_aliases
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

-- Index for filtering active vs archived
CREATE INDEX IF NOT EXISTS idx_supplier_extracted_products_archived 
  ON public.supplier_extracted_products(establishment_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_invoice_suppliers_archived 
  ON public.invoice_suppliers(establishment_id, archived_at);