
-- ═══════════════════════════════════════════════════════════════════════════
-- TVA France B2B: b2b_invoice_lines table (snapshot lignes facture)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.b2b_invoice_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  label_snapshot TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  vat_rate NUMERIC NOT NULL DEFAULT 0,
  unit_price_ht NUMERIC NOT NULL,
  unit_price_ttc NUMERIC NOT NULL,
  line_total_ht NUMERIC NOT NULL,
  vat_amount NUMERIC NOT NULL DEFAULT 0,
  line_total_ttc NUMERIC NOT NULL,
  line_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by invoice
CREATE INDEX idx_b2b_invoice_lines_invoice ON public.b2b_invoice_lines(invoice_id);

-- RLS
ALTER TABLE public.b2b_invoice_lines ENABLE ROW LEVEL SECURITY;

-- Policy: users can read lines for invoices in their establishment
CREATE POLICY "b2b_invoice_lines_select"
  ON public.b2b_invoice_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      JOIN public.user_establishments ue ON ue.establishment_id = i.establishment_id
      WHERE i.id = b2b_invoice_lines.invoice_id
        AND ue.user_id = auth.uid()
    )
  );

-- Policy: insert allowed for authenticated users (via enrichment service)
CREATE POLICY "b2b_invoice_lines_insert"
  ON public.b2b_invoice_lines
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      JOIN public.user_establishments ue ON ue.establishment_id = i.establishment_id
      WHERE i.id = b2b_invoice_lines.invoice_id
        AND ue.user_id = auth.uid()
    )
  );
