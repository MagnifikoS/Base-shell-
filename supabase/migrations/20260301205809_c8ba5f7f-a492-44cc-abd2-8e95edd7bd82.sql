-- FIX 1: Remove is_active reference from fn_complete_inventory_session
CREATE OR REPLACE FUNCTION public.fn_complete_inventory_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session RECORD;
  v_actual_counted INT;
  v_actual_total INT;
BEGIN
  -- 1. Lock session
  SELECT id, status, establishment_id, organization_id, storage_zone_id
  INTO v_session
  FROM inventory_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND');
  END IF;

  -- Idempotency: already completed
  IF v_session.status = 'termine' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  -- Precondition: must be en_cours or en_pause
  IF v_session.status NOT IN ('en_cours', 'en_pause') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STATUS_CONFLICT', 'current_status', v_session.status);
  END IF;

  -- 2. Reconcile counts
  SELECT COUNT(*) FILTER (WHERE counted_at IS NOT NULL), COUNT(*)
  INTO v_actual_counted, v_actual_total
  FROM inventory_lines
  WHERE session_id = p_session_id;

  -- 3. Atomic: update session
  UPDATE inventory_sessions
  SET status = 'termine',
      completed_at = NOW(),
      counted_products = v_actual_counted,
      total_products = v_actual_total,
      updated_at = NOW()
  WHERE id = p_session_id;

  -- 4. Upsert zone snapshot (SSOT) — NO is_active reference
  INSERT INTO zone_stock_snapshots (establishment_id, organization_id, storage_zone_id, snapshot_version_id, activated_at)
  VALUES (v_session.establishment_id, v_session.organization_id, v_session.storage_zone_id, p_session_id, NOW())
  ON CONFLICT (establishment_id, storage_zone_id)
  DO UPDATE SET
    snapshot_version_id = EXCLUDED.snapshot_version_id,
    activated_at = EXCLUDED.activated_at,
    updated_at = NOW();

  RETURN jsonb_build_object(
    'ok', true,
    'counted_products', v_actual_counted,
    'total_products', v_actual_total
  );
END;
$$;

-- FIX 2: Auto-abandon stale DRAFTs (>15 min) — server-side function
CREATE OR REPLACE FUNCTION public.fn_abandon_stale_drafts(
  p_establishment_id uuid,
  p_storage_zone_id uuid,
  p_type text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE stock_documents
  SET status = 'ABANDONED',
      updated_at = NOW()
  WHERE establishment_id = p_establishment_id
    AND storage_zone_id = p_storage_zone_id
    AND type = p_type::stock_document_type
    AND status = 'DRAFT'
    AND created_at < NOW() - INTERVAL '15 minutes';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- FIX 3: Backfill final_unit_id for existing products
-- Match by establishment_id + unit name (case-insensitive)
WITH matches AS (
  SELECT DISTINCT ON (p.id)
    p.id AS product_id,
    mu.id AS unit_id
  FROM products_v2 p
  CROSS JOIN LATERAL (
    SELECT (p.conditionnement_config->>'finalUnit') AS final_unit_text
  ) cfg
  JOIN measurement_units mu
    ON mu.establishment_id = p.establishment_id
    AND LOWER(mu.name) = LOWER(cfg.final_unit_text)
  WHERE p.final_unit_id IS NULL
    AND cfg.final_unit_text IS NOT NULL
    AND cfg.final_unit_text != ''
    AND p.archived_at IS NULL
)
UPDATE products_v2
SET final_unit_id = matches.unit_id,
    updated_at = NOW()
FROM matches
WHERE products_v2.id = matches.product_id;