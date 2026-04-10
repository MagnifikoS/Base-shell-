
-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: fn_archive_product_v2 — Atomic soft-delete (archive) of a product
-- ═══════════════════════════════════════════════════════════════════════════
-- Steps (all in one transaction):
-- 1. Remove inventory_lines from active sessions (en_cours / en_pause)
-- 2. Update session counters (total_products, counted_products)
-- 3. Remove inventory_zone_products mappings
-- 4. Set archived_at on the product
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_archive_product_v2(p_product_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_total INT;
  v_counted INT;
BEGIN
  -- 1. Delete inventory_lines from active sessions
  DELETE FROM public.inventory_lines
  WHERE product_id = p_product_id
    AND session_id IN (
      SELECT id FROM public.inventory_sessions
      WHERE status IN ('en_cours', 'en_pause')
    );

  -- 2. Update counters for affected active sessions
  FOR v_session IN
    SELECT id FROM public.inventory_sessions
    WHERE status IN ('en_cours', 'en_pause')
  LOOP
    SELECT COUNT(*) INTO v_total
    FROM public.inventory_lines
    WHERE session_id = v_session.id;

    SELECT COUNT(*) INTO v_counted
    FROM public.inventory_lines
    WHERE session_id = v_session.id
      AND counted_at IS NOT NULL;

    UPDATE public.inventory_sessions
    SET total_products = v_total,
        counted_products = v_counted,
        updated_at = now()
    WHERE id = v_session.id;
  END LOOP;

  -- 3. Remove zone product mappings
  DELETE FROM public.inventory_zone_products
  WHERE product_id = p_product_id;

  -- 4. Archive the product
  UPDATE public.products_v2
  SET archived_at = now()
  WHERE id = p_product_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: fn_hard_delete_product_v2 — Atomic permanent delete of a product
-- ═══════════════════════════════════════════════════════════════════════════
-- Steps (all in one transaction):
-- 1. Remove inventory_lines from active sessions + update counters
-- 2. Remove ALL inventory_lines (including completed sessions)
-- 3. Remove inventory_zone_products
-- 4. Remove stock_monthly_snapshot_lines
-- 5. Remove stock_events
-- 6. Remove stock_document_lines
-- 7. Remove supplier_product_aliases
-- 8. Remove b2b_imported_products
-- 9. Delete the product (will fail with FK if BL/commande lines exist)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_hard_delete_product_v2(p_product_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_total INT;
  v_counted INT;
BEGIN
  -- 1. Cleanup active inventory sessions
  DELETE FROM public.inventory_lines
  WHERE product_id = p_product_id
    AND session_id IN (
      SELECT id FROM public.inventory_sessions
      WHERE status IN ('en_cours', 'en_pause')
    );

  FOR v_session IN
    SELECT id FROM public.inventory_sessions
    WHERE status IN ('en_cours', 'en_pause')
  LOOP
    SELECT COUNT(*) INTO v_total
    FROM public.inventory_lines
    WHERE session_id = v_session.id;

    SELECT COUNT(*) INTO v_counted
    FROM public.inventory_lines
    WHERE session_id = v_session.id
      AND counted_at IS NOT NULL;

    UPDATE public.inventory_sessions
    SET total_products = v_total,
        counted_products = v_counted,
        updated_at = now()
    WHERE id = v_session.id;
  END LOOP;

  -- 2. Remove ALL inventory lines (including completed sessions)
  DELETE FROM public.inventory_lines
  WHERE product_id = p_product_id;

  -- 3. Remove zone mappings
  DELETE FROM public.inventory_zone_products
  WHERE product_id = p_product_id;

  -- 4. Remove stock snapshot lines
  DELETE FROM public.stock_monthly_snapshot_lines
  WHERE product_id = p_product_id;

  -- 5. Remove stock events
  DELETE FROM public.stock_events
  WHERE product_id = p_product_id;

  -- 6. Remove stock document lines
  DELETE FROM public.stock_document_lines
  WHERE product_id = p_product_id;

  -- 7. Remove supplier product aliases
  DELETE FROM public.supplier_product_aliases
  WHERE global_product_id = p_product_id;

  -- 8. Remove B2B import tracking
  DELETE FROM public.b2b_imported_products
  WHERE local_product_id = p_product_id;

  -- 9. Hard delete the product
  DELETE FROM public.products_v2
  WHERE id = p_product_id;
END;
$$;
