
-- Drop partial artifacts from failed migration
DROP TYPE IF EXISTS public.return_type CASCADE;
DROP TYPE IF EXISTS public.return_status CASCADE;
DROP TYPE IF EXISTS public.return_resolution CASCADE;

-- Return type enum
CREATE TYPE public.return_type AS ENUM (
  'mauvais_produit',
  'produit_en_plus',
  'produit_casse',
  'dlc_depassee',
  'dlc_trop_proche',
  'non_conforme'
);

CREATE TYPE public.return_status AS ENUM ('pending', 'accepted', 'refused');
CREATE TYPE public.return_resolution AS ENUM ('avoir', 'remplacement', 'retour_physique');

-- Main table
CREATE TABLE public.product_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_id UUID NOT NULL REFERENCES public.commandes(id) ON DELETE CASCADE,
  commande_line_id UUID REFERENCES public.commande_lines(id) ON DELETE SET NULL,
  product_id UUID NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  canonical_unit_id UUID REFERENCES public.measurement_units(id),
  unit_label_snapshot TEXT,
  return_type public.return_type NOT NULL,
  reason_comment TEXT,
  client_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  supplier_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  status public.return_status NOT NULL DEFAULT 'pending',
  resolution public.return_resolution,
  supplier_comment TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.product_return_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.product_returns(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  original_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_returns_commande ON public.product_returns(commande_id);
CREATE INDEX idx_product_returns_client ON public.product_returns(client_establishment_id);
CREATE INDEX idx_product_returns_supplier ON public.product_returns(supplier_establishment_id);
CREATE INDEX idx_product_returns_status ON public.product_returns(status);
CREATE INDEX idx_product_return_photos_return ON public.product_return_photos(return_id);

ALTER TABLE public.product_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_return_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view returns for their establishments"
  ON public.product_returns FOR SELECT TO authenticated
  USING (
    client_establishment_id IN (SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid())
    OR supplier_establishment_id IN (SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid())
  );

CREATE POLICY "Client can create returns"
  ON public.product_returns FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND client_establishment_id IN (SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid())
  );

CREATE POLICY "Supplier can update returns"
  ON public.product_returns FOR UPDATE TO authenticated
  USING (
    supplier_establishment_id IN (SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can view return photos"
  ON public.product_return_photos FOR SELECT TO authenticated
  USING (
    return_id IN (
      SELECT id FROM public.product_returns WHERE
        client_establishment_id IN (SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid())
        OR supplier_establishment_id IN (SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Client can add return photos"
  ON public.product_return_photos FOR INSERT TO authenticated
  WITH CHECK (
    return_id IN (
      SELECT id FROM public.product_returns WHERE
        created_by = auth.uid()
        AND client_establishment_id IN (SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid())
    )
  );

INSERT INTO storage.buckets (id, name, public) VALUES ('return-photos', 'return-photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Auth users can upload return photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'return-photos');

CREATE POLICY "Auth users can view return photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'return-photos');
