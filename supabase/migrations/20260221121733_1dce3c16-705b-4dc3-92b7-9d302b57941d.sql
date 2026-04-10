
-- ══════════════════════════════════════════════════════════════
-- MODULE: Mise en place (MEP) — Fully isolated, deletable
-- No FK to products_v2, stock_events, invoices, etc.
-- ══════════════════════════════════════════════════════════════

-- 1. Conditioning types (internal list)
CREATE TABLE public.mep_conditioning_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(establishment_id, name)
);

ALTER TABLE public.mep_conditioning_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mep_conditioning_types_select" ON public.mep_conditioning_types
  FOR SELECT USING (
    establishment_id IN (SELECT public.get_user_establishment_ids())
  );
CREATE POLICY "mep_conditioning_types_insert" ON public.mep_conditioning_types
  FOR INSERT WITH CHECK (
    establishment_id IN (SELECT public.get_user_establishment_ids())
  );
CREATE POLICY "mep_conditioning_types_update" ON public.mep_conditioning_types
  FOR UPDATE USING (
    establishment_id IN (SELECT public.get_user_establishment_ids())
  );
CREATE POLICY "mep_conditioning_types_delete" ON public.mep_conditioning_types
  FOR DELETE USING (
    establishment_id IN (SELECT public.get_user_establishment_ids())
  );

-- 2. Transformed products (internal catalog)
CREATE TABLE public.mep_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  name TEXT NOT NULL,
  conditioning_type_id UUID REFERENCES public.mep_conditioning_types(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mep_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mep_products_select" ON public.mep_products
  FOR SELECT USING (establishment_id IN (SELECT public.get_user_establishment_ids()));
CREATE POLICY "mep_products_insert" ON public.mep_products
  FOR INSERT WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));
CREATE POLICY "mep_products_update" ON public.mep_products
  FOR UPDATE USING (establishment_id IN (SELECT public.get_user_establishment_ids()));
CREATE POLICY "mep_products_delete" ON public.mep_products
  FOR DELETE USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- 3. Orders
CREATE TABLE public.mep_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  created_by UUID NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mep_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mep_orders_select" ON public.mep_orders
  FOR SELECT USING (establishment_id IN (SELECT public.get_user_establishment_ids()));
CREATE POLICY "mep_orders_insert" ON public.mep_orders
  FOR INSERT WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));
CREATE POLICY "mep_orders_update" ON public.mep_orders
  FOR UPDATE USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- 4. Order lines
CREATE TABLE public.mep_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.mep_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.mep_products(id),
  product_name_snapshot TEXT NOT NULL,
  conditioning_name_snapshot TEXT,
  quantity INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'unavailable')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mep_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mep_order_lines_select" ON public.mep_order_lines
  FOR SELECT USING (
    order_id IN (SELECT id FROM public.mep_orders WHERE establishment_id IN (SELECT public.get_user_establishment_ids()))
  );
CREATE POLICY "mep_order_lines_insert" ON public.mep_order_lines
  FOR INSERT WITH CHECK (
    order_id IN (SELECT id FROM public.mep_orders WHERE establishment_id IN (SELECT public.get_user_establishment_ids()))
  );
CREATE POLICY "mep_order_lines_update" ON public.mep_order_lines
  FOR UPDATE USING (
    order_id IN (SELECT id FROM public.mep_orders WHERE establishment_id IN (SELECT public.get_user_establishment_ids()))
  );
