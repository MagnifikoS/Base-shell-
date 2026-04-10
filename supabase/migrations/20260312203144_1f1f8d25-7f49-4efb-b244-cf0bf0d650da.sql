
-- Table: to_order_lines — isolated memo for "À commander" feature
CREATE TABLE public.to_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products_v2(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.invoice_suppliers(id) ON DELETE CASCADE,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_id uuid NOT NULL REFERENCES public.measurement_units(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'checked', 'validated')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  UNIQUE (establishment_id, product_id, supplier_id, status)
);

-- Index for fast lookup by establishment
CREATE INDEX idx_to_order_lines_establishment ON public.to_order_lines(establishment_id);
CREATE INDEX idx_to_order_lines_supplier ON public.to_order_lines(establishment_id, supplier_id);

-- RLS
ALTER TABLE public.to_order_lines ENABLE ROW LEVEL SECURITY;

-- Policy: users can read lines for establishments they belong to
CREATE POLICY "to_order_lines_select" ON public.to_order_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_establishments ue
      WHERE ue.establishment_id = to_order_lines.establishment_id
        AND ue.user_id = auth.uid()
    )
  );

-- Policy: users can insert lines for their establishments
CREATE POLICY "to_order_lines_insert" ON public.to_order_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_establishments ue
      WHERE ue.establishment_id = to_order_lines.establishment_id
        AND ue.user_id = auth.uid()
    )
  );

-- Policy: users can update lines for their establishments
CREATE POLICY "to_order_lines_update" ON public.to_order_lines
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_establishments ue
      WHERE ue.establishment_id = to_order_lines.establishment_id
        AND ue.user_id = auth.uid()
    )
  );

-- Policy: users can delete lines for their establishments
CREATE POLICY "to_order_lines_delete" ON public.to_order_lines
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_establishments ue
      WHERE ue.establishment_id = to_order_lines.establishment_id
        AND ue.user_id = auth.uid()
    )
  );
