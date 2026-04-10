
-- Table for dismissed suggestions (keyed by sorted product ID pairs)
CREATE TABLE public.inventory_mutualisation_dismissed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  product_ids_hash text NOT NULL,
  dismissed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (establishment_id, product_ids_hash)
);

ALTER TABLE public.inventory_mutualisation_dismissed ENABLE ROW LEVEL SECURITY;

-- RLS: authenticated users in same org can read/write
CREATE POLICY "Users can read dismissed suggestions for their establishment"
  ON public.inventory_mutualisation_dismissed
  FOR SELECT TO authenticated
  USING (
    establishment_id IN (
      SELECT id FROM public.establishments e
      WHERE e.organization_id IN (
        SELECT organization_id FROM public.profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can insert dismissed suggestions for their establishment"
  ON public.inventory_mutualisation_dismissed
  FOR INSERT TO authenticated
  WITH CHECK (
    establishment_id IN (
      SELECT id FROM public.establishments e
      WHERE e.organization_id IN (
        SELECT organization_id FROM public.profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can delete dismissed suggestions for their establishment"
  ON public.inventory_mutualisation_dismissed
  FOR DELETE TO authenticated
  USING (
    establishment_id IN (
      SELECT id FROM public.establishments e
      WHERE e.organization_id IN (
        SELECT organization_id FROM public.profiles WHERE id = auth.uid()
      )
    )
  );
