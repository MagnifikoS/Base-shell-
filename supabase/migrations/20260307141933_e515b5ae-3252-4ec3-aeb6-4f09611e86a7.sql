
-- ═══════════════════════════════════════════════════════════════════
-- MUTUALISATION INVENTAIRE — 3 tables (settings already created, skip it)
-- ═══════════════════════════════════════════════════════════════════

-- Fix: drop the tables created by the failed partial migration if they exist
DROP TABLE IF EXISTS public.inventory_mutualisation_members CASCADE;
DROP TABLE IF EXISTS public.inventory_mutualisation_groups CASCADE;
DROP TABLE IF EXISTS public.inventory_mutualisation_settings CASCADE;

-- 1. Toggle par établissement
CREATE TABLE public.inventory_mutualisation_settings (
  establishment_id uuid PRIMARY KEY REFERENCES public.establishments(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.inventory_mutualisation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mut_settings_select"
  ON public.inventory_mutualisation_settings FOR SELECT TO authenticated
  USING (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue WHERE ue.user_id = auth.uid()
    )
  );

CREATE POLICY "mut_settings_all"
  ON public.inventory_mutualisation_settings FOR ALL TO authenticated
  USING (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue WHERE ue.user_id = auth.uid()
    )
  )
  WITH CHECK (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue WHERE ue.user_id = auth.uid()
    )
  );

-- 2. Groupes de mutualisation
CREATE TABLE public.inventory_mutualisation_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  carrier_product_id uuid NOT NULL REFERENCES public.products_v2(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mut_groups_establishment ON public.inventory_mutualisation_groups(establishment_id);

ALTER TABLE public.inventory_mutualisation_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mut_groups_all"
  ON public.inventory_mutualisation_groups FOR ALL TO authenticated
  USING (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue WHERE ue.user_id = auth.uid()
    )
  )
  WITH CHECK (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue WHERE ue.user_id = auth.uid()
    )
  );

-- 3. Membres d'un groupe
CREATE TABLE public.inventory_mutualisation_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.inventory_mutualisation_groups(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products_v2(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, product_id)
);

CREATE INDEX idx_mut_members_group ON public.inventory_mutualisation_members(group_id);
CREATE INDEX idx_mut_members_product ON public.inventory_mutualisation_members(product_id);

ALTER TABLE public.inventory_mutualisation_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mut_members_all"
  ON public.inventory_mutualisation_members FOR ALL TO authenticated
  USING (
    group_id IN (
      SELECT id FROM public.inventory_mutualisation_groups
      WHERE establishment_id IN (
        SELECT ue.establishment_id FROM public.user_establishments ue WHERE ue.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    group_id IN (
      SELECT id FROM public.inventory_mutualisation_groups
      WHERE establishment_id IN (
        SELECT ue.establishment_id FROM public.user_establishments ue WHERE ue.user_id = auth.uid()
      )
    )
  );
