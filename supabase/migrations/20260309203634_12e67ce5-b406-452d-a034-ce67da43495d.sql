
-- ═══════════════════════════════════════════════════════════════
-- ÉTAPE 1 — Facture mixte V1 : table lignes plats + RLS
-- ═══════════════════════════════════════════════════════════════

-- 1. Créer la table dédiée aux lignes plats facturées
CREATE TABLE public.app_invoice_dish_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_invoice_id uuid NOT NULL REFERENCES public.app_invoices(id) ON DELETE CASCADE,
  commande_plat_line_id uuid NOT NULL REFERENCES public.commande_plat_lines(id),
  listing_id uuid NOT NULL REFERENCES public.b2b_recipe_listings(id),
  commercial_name_snapshot text NOT NULL,
  portions_snapshot integer,
  quantity numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Index
CREATE INDEX idx_app_invoice_dish_lines_invoice ON public.app_invoice_dish_lines(app_invoice_id);

-- 3. RLS
ALTER TABLE public.app_invoice_dish_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view dish lines of invoices they can see"
  ON public.app_invoice_dish_lines
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_invoices ai
      JOIN public.user_establishments ue
        ON ue.establishment_id IN (ai.supplier_establishment_id, ai.client_establishment_id)
      WHERE ai.id = app_invoice_dish_lines.app_invoice_id
        AND ue.user_id = auth.uid()
    )
  );

CREATE POLICY "Only system can insert dish lines"
  ON public.app_invoice_dish_lines
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "Only system can update dish lines"
  ON public.app_invoice_dish_lines
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Only system can delete dish lines"
  ON public.app_invoice_dish_lines
  FOR DELETE
  TO authenticated
  USING (false);
