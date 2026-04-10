
-- ═══════════════════════════════════════════════════════════════════════════
-- MEP V0.2: Cross-establishment orders (source → destination)
-- Complete redo — all steps atomic
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add source/destination columns
ALTER TABLE public.mep_orders
  ADD COLUMN IF NOT EXISTS source_establishment_id UUID REFERENCES public.establishments(id),
  ADD COLUMN IF NOT EXISTS destination_establishment_id UUID REFERENCES public.establishments(id);

-- Backfill existing orders
UPDATE public.mep_orders
SET source_establishment_id = establishment_id
WHERE source_establishment_id IS NULL;

-- Make source NOT NULL
ALTER TABLE public.mep_orders
  ALTER COLUMN source_establishment_id SET NOT NULL;

-- 2. Register module for RBAC
INSERT INTO public.modules (key, name, display_order)
VALUES ('mise_en_place', 'Mise en place', 108)
ON CONFLICT (key) DO NOTHING;

-- 3. Drop ALL old policies on mep_orders
DROP POLICY IF EXISTS "Users can view orders in their establishment" ON public.mep_orders;
DROP POLICY IF EXISTS "Users can create orders in their establishment" ON public.mep_orders;
DROP POLICY IF EXISTS "mep_orders_select_cross_est" ON public.mep_orders;
DROP POLICY IF EXISTS "mep_orders_insert_source" ON public.mep_orders;
DROP POLICY IF EXISTS "mep_orders_update_cross_est" ON public.mep_orders;

-- 4. New cross-establishment policies
CREATE POLICY "mep_orders_select_cross_est"
ON public.mep_orders FOR SELECT TO authenticated
USING (
  source_establishment_id IN (SELECT public.get_user_establishment_ids())
  OR destination_establishment_id IN (SELECT public.get_user_establishment_ids())
);

CREATE POLICY "mep_orders_insert_source"
ON public.mep_orders FOR INSERT TO authenticated
WITH CHECK (
  source_establishment_id IN (SELECT public.get_user_establishment_ids())
  AND created_by = auth.uid()
);

CREATE POLICY "mep_orders_update_cross_est"
ON public.mep_orders FOR UPDATE TO authenticated
USING (
  source_establishment_id IN (SELECT public.get_user_establishment_ids())
  OR destination_establishment_id IN (SELECT public.get_user_establishment_ids())
);

-- 5. Drop ALL old policies on mep_order_lines
DROP POLICY IF EXISTS "Users can view order lines in their establishment" ON public.mep_order_lines;
DROP POLICY IF EXISTS "Users can insert order lines for their orders" ON public.mep_order_lines;
DROP POLICY IF EXISTS "Users can update order line status" ON public.mep_order_lines;
DROP POLICY IF EXISTS "mep_order_lines_select" ON public.mep_order_lines;
DROP POLICY IF EXISTS "mep_order_lines_insert" ON public.mep_order_lines;
DROP POLICY IF EXISTS "mep_order_lines_update" ON public.mep_order_lines;

-- 6. New cross-establishment policies for lines
CREATE POLICY "mep_order_lines_select"
ON public.mep_order_lines FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.mep_orders o
    WHERE o.id = order_id
    AND (
      o.source_establishment_id IN (SELECT public.get_user_establishment_ids())
      OR o.destination_establishment_id IN (SELECT public.get_user_establishment_ids())
    )
  )
);

CREATE POLICY "mep_order_lines_insert"
ON public.mep_order_lines FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.mep_orders o
    WHERE o.id = order_id
    AND o.source_establishment_id IN (SELECT public.get_user_establishment_ids())
    AND o.created_by = auth.uid()
  )
);

CREATE POLICY "mep_order_lines_update"
ON public.mep_order_lines FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.mep_orders o
    WHERE o.id = order_id
    AND o.destination_establishment_id IN (SELECT public.get_user_establishment_ids())
  )
);
