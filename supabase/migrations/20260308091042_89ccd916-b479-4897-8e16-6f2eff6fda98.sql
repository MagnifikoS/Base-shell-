
-- ═══════════════════════════════════════════════════════════════
-- MODULE RECETTES — Phase 1 : Schema
-- ═══════════════════════════════════════════════════════════════

-- 1. recipe_types (classement des recettes)
CREATE TABLE public.recipe_types (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (establishment_id, name)
);

ALTER TABLE public.recipe_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipe_types_select" ON public.recipe_types
  FOR SELECT TO authenticated
  USING (
    establishment_id IN (
      SELECT e.id FROM public.establishments e
      INNER JOIN public.user_establishments ue ON ue.establishment_id = e.id
      WHERE ue.user_id = auth.uid()
    )
  );

CREATE POLICY "recipe_types_insert" ON public.recipe_types
  FOR INSERT TO authenticated
  WITH CHECK (
    establishment_id IN (
      SELECT e.id FROM public.establishments e
      INNER JOIN public.user_establishments ue ON ue.establishment_id = e.id
      WHERE ue.user_id = auth.uid()
    )
  );

CREATE POLICY "recipe_types_update" ON public.recipe_types
  FOR UPDATE TO authenticated
  USING (
    establishment_id IN (
      SELECT e.id FROM public.establishments e
      INNER JOIN public.user_establishments ue ON ue.establishment_id = e.id
      WHERE ue.user_id = auth.uid()
    )
  );

CREATE POLICY "recipe_types_delete" ON public.recipe_types
  FOR DELETE TO authenticated
  USING (
    establishment_id IN (
      SELECT e.id FROM public.establishments e
      INNER JOIN public.user_establishments ue ON ue.establishment_id = e.id
      WHERE ue.user_id = auth.uid()
    )
  );

-- 2. recipes
CREATE TABLE public.recipes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  recipe_type_id UUID NOT NULL REFERENCES public.recipe_types(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipes_select" ON public.recipes
  FOR SELECT TO authenticated
  USING (
    establishment_id IN (
      SELECT e.id FROM public.establishments e
      INNER JOIN public.user_establishments ue ON ue.establishment_id = e.id
      WHERE ue.user_id = auth.uid()
    )
  );

CREATE POLICY "recipes_insert" ON public.recipes
  FOR INSERT TO authenticated
  WITH CHECK (
    establishment_id IN (
      SELECT e.id FROM public.establishments e
      INNER JOIN public.user_establishments ue ON ue.establishment_id = e.id
      WHERE ue.user_id = auth.uid()
    )
  );

CREATE POLICY "recipes_update" ON public.recipes
  FOR UPDATE TO authenticated
  USING (
    establishment_id IN (
      SELECT e.id FROM public.establishments e
      INNER JOIN public.user_establishments ue ON ue.establishment_id = e.id
      WHERE ue.user_id = auth.uid()
    )
  );

CREATE POLICY "recipes_delete" ON public.recipes
  FOR DELETE TO authenticated
  USING (
    establishment_id IN (
      SELECT e.id FROM public.establishments e
      INNER JOIN public.user_establishments ue ON ue.establishment_id = e.id
      WHERE ue.user_id = auth.uid()
    )
  );

-- 3. recipe_lines (ingrédients)
CREATE TABLE public.recipe_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products_v2(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL,
  unit_id UUID NOT NULL REFERENCES public.measurement_units(id) ON DELETE RESTRICT,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.recipe_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipe_lines_select" ON public.recipe_lines
  FOR SELECT TO authenticated
  USING (
    recipe_id IN (
      SELECT r.id FROM public.recipes r
      WHERE r.establishment_id IN (
        SELECT e.id FROM public.establishments e
        INNER JOIN public.user_establishments ue ON ue.establishment_id = e.id
        WHERE ue.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "recipe_lines_insert" ON public.recipe_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    recipe_id IN (
      SELECT r.id FROM public.recipes r
      WHERE r.establishment_id IN (
        SELECT e.id FROM public.establishments e
        INNER JOIN public.user_establishments ue ON ue.establishment_id = e.id
        WHERE ue.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "recipe_lines_update" ON public.recipe_lines
  FOR UPDATE TO authenticated
  USING (
    recipe_id IN (
      SELECT r.id FROM public.recipes r
      WHERE r.establishment_id IN (
        SELECT e.id FROM public.establishments e
        INNER JOIN public.user_establishments ue ON ue.establishment_id = e.id
        WHERE ue.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "recipe_lines_delete" ON public.recipe_lines
  FOR DELETE TO authenticated
  USING (
    recipe_id IN (
      SELECT r.id FROM public.recipes r
      WHERE r.establishment_id IN (
        SELECT e.id FROM public.establishments e
        INNER JOIN public.user_establishments ue ON ue.establishment_id = e.id
        WHERE ue.user_id = auth.uid()
      )
    )
  );
