
-- ═══════════════════════════════════════════════════════════════
-- B2B CATALOGUE — ÉTAPE 2 : Tables + RPCs
-- ═══════════════════════════════════════════════════════════════

-- 1. Table de tracking des imports B2B
CREATE TABLE public.b2b_imported_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  source_product_id UUID NOT NULL,
  source_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  local_product_id UUID NOT NULL REFERENCES public.products_v2(id) ON DELETE CASCADE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by UUID NOT NULL,
  UNIQUE (establishment_id, source_product_id, source_establishment_id)
);

ALTER TABLE public.b2b_imported_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "b2b_imported_products_select"
ON public.b2b_imported_products FOR SELECT TO authenticated
USING (establishment_id IN (SELECT get_user_establishment_ids()));

CREATE POLICY "b2b_imported_products_insert"
ON public.b2b_imported_products FOR INSERT TO authenticated
WITH CHECK (establishment_id IN (SELECT get_user_establishment_ids()));

-- No UPDATE/DELETE needed (tracking is immutable)

-- 2. RPC: Get B2B catalogue (SECURITY DEFINER — reads supplier products safely)
CREATE OR REPLACE FUNCTION public.fn_get_b2b_catalogue(
  p_partnership_id UUID,
  p_client_establishment_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partnership b2b_partnerships%ROWTYPE;
  v_supplier_est_id UUID;
  v_products JSONB;
  v_units JSONB;
BEGIN
  -- 1. Verify caller belongs to client establishment
  IF NOT EXISTS (
    SELECT 1 FROM get_user_establishment_ids() AS eid
    WHERE eid = p_client_establishment_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  -- 2. Verify partnership exists and is active
  SELECT * INTO v_partnership
  FROM b2b_partnerships
  WHERE id = p_partnership_id
    AND client_establishment_id = p_client_establishment_id
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PARTNERSHIP_NOT_FOUND');
  END IF;

  v_supplier_est_id := v_partnership.supplier_establishment_id;

  -- 3. Get supplier products (non-archived only)
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
  INTO v_products
  FROM (
    SELECT
      p.id,
      p.nom_produit,
      p.code_produit,
      p.category_id,
      pc.name AS category_name,
      p.final_unit_price,
      p.conditionnement_config,
      p.conditionnement_resume,
      p.final_unit_id,
      p.supplier_billing_unit_id,
      p.delivery_unit_id,
      p.stock_handling_unit_id,
      p.kitchen_unit_id,
      p.price_display_unit_id
    FROM products_v2 p
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    WHERE p.establishment_id = v_supplier_est_id
      AND p.archived_at IS NULL
    ORDER BY p.nom_produit
  ) sub;

  -- 4. Get units used by supplier products (for Phase B mapping)
  SELECT COALESCE(jsonb_agg(row_to_json(u)::jsonb), '[]'::jsonb)
  INTO v_units
  FROM (
    SELECT DISTINCT mu.id, mu.name, mu.abbreviation, mu.family, mu.category, mu.is_reference, mu.aliases
    FROM measurement_units mu
    WHERE mu.establishment_id = v_supplier_est_id
      AND mu.is_active = true
  ) u;

  RETURN jsonb_build_object(
    'ok', true,
    'products', v_products,
    'supplier_units', v_units,
    'supplier_establishment_id', v_supplier_est_id
  );
END;
$$;

-- 3. RPC: Atomic import of a single B2B product
CREATE OR REPLACE FUNCTION public.fn_import_b2b_product_atomic(
  p_establishment_id UUID,
  p_user_id UUID,
  p_nom_produit TEXT,
  p_name_normalized TEXT,
  p_code_produit TEXT,
  p_category TEXT,
  p_category_id UUID,
  p_supplier_id UUID,
  p_final_unit_id UUID,
  p_supplier_billing_unit_id UUID,
  p_delivery_unit_id UUID,
  p_stock_handling_unit_id UUID,
  p_kitchen_unit_id UUID,
  p_price_display_unit_id UUID,
  p_min_stock_unit_id UUID,
  p_final_unit_price NUMERIC,
  p_conditionnement_config JSONB,
  p_conditionnement_resume TEXT,
  p_min_stock_quantity_canonical NUMERIC,
  p_storage_zone_id UUID,
  p_source_product_id UUID,
  p_source_establishment_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
BEGIN
  -- 1. Verify caller belongs to establishment
  IF NOT EXISTS (
    SELECT 1 FROM get_user_establishment_ids() AS eid
    WHERE eid = p_establishment_id
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- 2. INSERT product (complete, not minimal)
  INSERT INTO products_v2 (
    establishment_id, nom_produit, name_normalized,
    code_produit, category, category_id, supplier_id, final_unit_id,
    supplier_billing_unit_id, delivery_unit_id, stock_handling_unit_id,
    kitchen_unit_id, price_display_unit_id, min_stock_unit_id,
    final_unit_price, conditionnement_config, conditionnement_resume,
    min_stock_quantity_canonical, storage_zone_id,
    created_by
  ) VALUES (
    p_establishment_id, p_nom_produit, p_name_normalized,
    p_code_produit, p_category, p_category_id, p_supplier_id, p_final_unit_id,
    p_supplier_billing_unit_id, p_delivery_unit_id, p_stock_handling_unit_id,
    p_kitchen_unit_id, p_price_display_unit_id, p_min_stock_unit_id,
    p_final_unit_price, p_conditionnement_config, p_conditionnement_resume,
    p_min_stock_quantity_canonical, p_storage_zone_id,
    p_user_id
  ) RETURNING id INTO v_product_id;

  -- 3. Inventory zone snapshot
  INSERT INTO inventory_zone_products (
    establishment_id, product_id, storage_zone_id, display_order
  ) VALUES (
    p_establishment_id, v_product_id, p_storage_zone_id, 0
  );

  -- 4. B2B tracking (anti-doublon)
  INSERT INTO b2b_imported_products (
    establishment_id, source_product_id, source_establishment_id,
    local_product_id, imported_by
  ) VALUES (
    p_establishment_id, p_source_product_id, p_source_establishment_id,
    v_product_id, p_user_id
  );

  RETURN v_product_id;
  -- Any error = automatic PostgreSQL ROLLBACK = 0 products, 0 tracking, 0 snapshot
END;
$$;
