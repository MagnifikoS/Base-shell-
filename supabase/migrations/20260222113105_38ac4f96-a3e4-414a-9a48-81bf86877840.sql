
-- ═══════════════════════════════════════════════════════════════════════════
-- Module Commande Produits V0 — Tables isolées, supprimables
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Table commande
CREATE TABLE public.product_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  source_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  destination_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','preparing','prepared','shipped','received','closed')),
  bl_retrait_document_id UUID REFERENCES public.bl_withdrawal_documents(id) ON DELETE SET NULL,
  bl_reception_document_id UUID REFERENCES public.bl_app_documents(id) ON DELETE SET NULL,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Table lignes commande
CREATE TABLE public.product_order_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.product_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  product_name_snapshot TEXT NOT NULL,
  quantity_requested NUMERIC(12,4) NOT NULL,
  quantity_prepared NUMERIC(12,4),
  quantity_received NUMERIC(12,4),
  canonical_unit_id UUID NOT NULL REFERENCES public.measurement_units(id),
  unit_label TEXT NOT NULL,
  prep_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (prep_status IN ('pending','ok','unavailable','partial')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Indexes
CREATE INDEX idx_product_orders_source ON public.product_orders(source_establishment_id);
CREATE INDEX idx_product_orders_dest ON public.product_orders(destination_establishment_id);
CREATE INDEX idx_product_orders_status ON public.product_orders(status);
CREATE INDEX idx_product_order_lines_order ON public.product_order_lines(order_id);

-- 4. RLS
ALTER TABLE public.product_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_order_lines ENABLE ROW LEVEL SECURITY;

-- Helper function: check if user belongs to an establishment
CREATE OR REPLACE FUNCTION public.user_belongs_to_establishment(_user_id UUID, _est_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_establishments
    WHERE user_id = _user_id AND establishment_id = _est_id
  );
$$;

-- product_orders: SELECT if user belongs to source OR destination
CREATE POLICY "product_orders_select"
ON public.product_orders FOR SELECT
USING (
  public.user_belongs_to_establishment(auth.uid(), source_establishment_id)
  OR public.user_belongs_to_establishment(auth.uid(), destination_establishment_id)
);

-- product_orders: INSERT if user belongs to source (client creates order)
CREATE POLICY "product_orders_insert"
ON public.product_orders FOR INSERT
WITH CHECK (
  public.user_belongs_to_establishment(auth.uid(), source_establishment_id)
);

-- product_orders: UPDATE if user belongs to source OR destination
CREATE POLICY "product_orders_update"
ON public.product_orders FOR UPDATE
USING (
  public.user_belongs_to_establishment(auth.uid(), source_establishment_id)
  OR public.user_belongs_to_establishment(auth.uid(), destination_establishment_id)
);

-- product_orders: DELETE only by source (cancel own order)
CREATE POLICY "product_orders_delete"
ON public.product_orders FOR DELETE
USING (
  public.user_belongs_to_establishment(auth.uid(), source_establishment_id)
);

-- product_order_lines: inherit access from parent order
CREATE POLICY "product_order_lines_select"
ON public.product_order_lines FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.product_orders po
    WHERE po.id = order_id
    AND (
      public.user_belongs_to_establishment(auth.uid(), po.source_establishment_id)
      OR public.user_belongs_to_establishment(auth.uid(), po.destination_establishment_id)
    )
  )
);

CREATE POLICY "product_order_lines_insert"
ON public.product_order_lines FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.product_orders po
    WHERE po.id = order_id
    AND public.user_belongs_to_establishment(auth.uid(), po.source_establishment_id)
  )
);

CREATE POLICY "product_order_lines_update"
ON public.product_order_lines FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.product_orders po
    WHERE po.id = order_id
    AND (
      public.user_belongs_to_establishment(auth.uid(), po.source_establishment_id)
      OR public.user_belongs_to_establishment(auth.uid(), po.destination_establishment_id)
    )
  )
);

CREATE POLICY "product_order_lines_delete"
ON public.product_order_lines FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.product_orders po
    WHERE po.id = order_id
    AND public.user_belongs_to_establishment(auth.uid(), po.source_establishment_id)
  )
);

-- 5. Updated_at trigger
CREATE TRIGGER update_product_orders_updated_at
BEFORE UPDATE ON public.product_orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_product_order_lines_updated_at
BEFORE UPDATE ON public.product_order_lines
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
