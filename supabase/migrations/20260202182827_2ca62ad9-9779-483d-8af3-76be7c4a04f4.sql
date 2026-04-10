-- ============================================================
-- PHASE 1: Create invoice_line_items table for quantity tracking
-- This table stores line-level details for each invoice
-- ============================================================

-- Create the table
CREATE TABLE public.invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES invoice_suppliers(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES supplier_extracted_products(id) ON DELETE SET NULL,
  year_month text NOT NULL,
  line_index integer NOT NULL,
  raw_label text,
  quantity numeric,
  unit_of_sale text,
  packaging text,
  unit_price numeric,
  line_total numeric,
  currency text DEFAULT 'EUR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add comment for documentation
COMMENT ON TABLE public.invoice_line_items IS 'Stores per-line details from invoices including quantities, prices, and product links';

-- Create performance indexes
CREATE INDEX idx_invoice_line_items_invoice_id ON public.invoice_line_items(invoice_id);
CREATE INDEX idx_invoice_line_items_prod_month ON public.invoice_line_items(establishment_id, product_id, year_month);
CREATE INDEX idx_invoice_line_items_supp_month ON public.invoice_line_items(establishment_id, supplier_id, year_month);

-- Enable Row Level Security
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies (same pattern as other factures tables)
CREATE POLICY "Users can view line items in their establishments"
ON public.invoice_line_items
FOR SELECT
USING (has_module_access('factures'::text, 'read'::access_level, establishment_id));

CREATE POLICY "Users can create line items in their establishments"
ON public.invoice_line_items
FOR INSERT
WITH CHECK (has_module_access('factures'::text, 'write'::access_level, establishment_id));

CREATE POLICY "Users can update line items in their establishments"
ON public.invoice_line_items
FOR UPDATE
USING (has_module_access('factures'::text, 'write'::access_level, establishment_id));

CREATE POLICY "Users can delete line items in their establishments"
ON public.invoice_line_items
FOR DELETE
USING (has_module_access('factures'::text, 'write'::access_level, establishment_id));