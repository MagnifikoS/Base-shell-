
-- ═══════════════════════════════════════════════════════════════════════════
-- MODULE INVENTAIRE V0 — Schema
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Enum statut inventaire (décision #8)
CREATE TYPE public.inventory_status AS ENUM ('en_cours', 'en_pause', 'termine', 'annule');

-- 2. Table: inventory_sessions (une session = un inventaire d'une zone)
CREATE TABLE public.inventory_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  storage_zone_id UUID NOT NULL REFERENCES public.storage_zones(id),
  status public.inventory_status NOT NULL DEFAULT 'en_cours',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  started_by UUID NOT NULL,
  total_products INTEGER NOT NULL DEFAULT 0,
  counted_products INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour requêtes fréquentes
CREATE INDEX idx_inventory_sessions_establishment ON public.inventory_sessions(establishment_id);
CREATE INDEX idx_inventory_sessions_zone_status ON public.inventory_sessions(storage_zone_id, status);

-- 3. Table: inventory_lines (une ligne = un produit compté)
CREATE TABLE public.inventory_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.inventory_sessions(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  quantity NUMERIC,
  unit_id UUID REFERENCES public.measurement_units(id),
  counted_at TIMESTAMPTZ,
  counted_by UUID,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index
CREATE INDEX idx_inventory_lines_session ON public.inventory_lines(session_id);
CREATE INDEX idx_inventory_lines_product ON public.inventory_lines(product_id);
-- Unicité: un produit par session
CREATE UNIQUE INDEX uq_inventory_lines_session_product ON public.inventory_lines(session_id, product_id);

-- 4. Table pivot: inventory_zone_products (ordre + unité préférée, isolé du module produits)
CREATE TABLE public.inventory_zone_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  storage_zone_id UUID NOT NULL REFERENCES public.storage_zones(id),
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  preferred_unit_id UUID REFERENCES public.measurement_units(id),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_inventory_zone_product ON public.inventory_zone_products(storage_zone_id, product_id);
CREATE INDEX idx_inventory_zone_products_establishment ON public.inventory_zone_products(establishment_id);

-- 5. Triggers updated_at
CREATE TRIGGER update_inventory_sessions_updated_at
  BEFORE UPDATE ON public.inventory_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_inventory_lines_updated_at
  BEFORE UPDATE ON public.inventory_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_inventory_zone_products_updated_at
  BEFORE UPDATE ON public.inventory_zone_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — Scoped par establishment via has_module_access
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.inventory_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_zone_products ENABLE ROW LEVEL SECURITY;

-- inventory_sessions: read
CREATE POLICY "Users can view inventory sessions in their establishments"
  ON public.inventory_sessions FOR SELECT TO authenticated
  USING (public.has_module_access('inventaire', 'read', establishment_id));

-- inventory_sessions: insert
CREATE POLICY "Users can create inventory sessions in their establishments"
  ON public.inventory_sessions FOR INSERT TO authenticated
  WITH CHECK (public.has_module_access('inventaire', 'write', establishment_id));

-- inventory_sessions: update
CREATE POLICY "Users can update inventory sessions in their establishments"
  ON public.inventory_sessions FOR UPDATE TO authenticated
  USING (public.has_module_access('inventaire', 'write', establishment_id));

-- inventory_sessions: delete (annulation)
CREATE POLICY "Users can delete inventory sessions in their establishments"
  ON public.inventory_sessions FOR DELETE TO authenticated
  USING (public.has_module_access('inventaire', 'full', establishment_id));

-- inventory_lines: read
CREATE POLICY "Users can view inventory lines in their sessions"
  ON public.inventory_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.inventory_sessions s
    WHERE s.id = inventory_lines.session_id
    AND public.has_module_access('inventaire', 'read', s.establishment_id)
  ));

-- inventory_lines: insert
CREATE POLICY "Users can create inventory lines in their sessions"
  ON public.inventory_lines FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.inventory_sessions s
    WHERE s.id = inventory_lines.session_id
    AND public.has_module_access('inventaire', 'write', s.establishment_id)
  ));

-- inventory_lines: update
CREATE POLICY "Users can update inventory lines in their sessions"
  ON public.inventory_lines FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.inventory_sessions s
    WHERE s.id = inventory_lines.session_id
    AND public.has_module_access('inventaire', 'write', s.establishment_id)
  ));

-- inventory_lines: delete
CREATE POLICY "Users can delete inventory lines in their sessions"
  ON public.inventory_lines FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.inventory_sessions s
    WHERE s.id = inventory_lines.session_id
    AND public.has_module_access('inventaire', 'full', s.establishment_id)
  ));

-- inventory_zone_products: read
CREATE POLICY "Users can view inventory zone products in their establishments"
  ON public.inventory_zone_products FOR SELECT TO authenticated
  USING (public.has_module_access('inventaire', 'read', establishment_id));

-- inventory_zone_products: insert
CREATE POLICY "Users can create inventory zone products in their establishments"
  ON public.inventory_zone_products FOR INSERT TO authenticated
  WITH CHECK (public.has_module_access('inventaire', 'write', establishment_id));

-- inventory_zone_products: update
CREATE POLICY "Users can update inventory zone products in their establishments"
  ON public.inventory_zone_products FOR UPDATE TO authenticated
  USING (public.has_module_access('inventaire', 'write', establishment_id));

-- inventory_zone_products: delete
CREATE POLICY "Users can delete inventory zone products in their establishments"
  ON public.inventory_zone_products FOR DELETE TO authenticated
  USING (public.has_module_access('inventaire', 'write', establishment_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- REALTIME (décision #2)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_lines;
