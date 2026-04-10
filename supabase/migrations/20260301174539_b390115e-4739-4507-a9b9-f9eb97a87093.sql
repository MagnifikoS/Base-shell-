
-- ═══════════════════════════════════════════════════════════════
-- F4: fn_quick_adjustment — Atomic QuickAdjustment RPC
-- Creates DRAFT + line + calls fn_post_stock_document in one transaction
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_quick_adjustment(
  p_establishment_id UUID,
  p_organization_id UUID,
  p_user_id UUID,
  p_product_id UUID,
  p_storage_zone_id UUID,
  p_estimated_qty NUMERIC,
  p_target_qty NUMERIC,
  p_canonical_unit_id UUID,
  p_canonical_family TEXT,
  p_canonical_label TEXT DEFAULT NULL,
  p_context_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delta NUMERIC;
  v_doc_id UUID;
  v_lock_version INT;
  v_idempotency_key TEXT;
  v_snapshot_exists BOOLEAN;
  v_post_result JSONB;
BEGIN
  v_delta := p_target_qty - p_estimated_qty;
  
  -- No-op if delta is zero
  IF v_delta = 0 THEN
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  -- Verify snapshot exists for this zone
  SELECT EXISTS(
    SELECT 1 FROM zone_stock_snapshots
    WHERE establishment_id = p_establishment_id
      AND storage_zone_id = p_storage_zone_id
  ) INTO v_snapshot_exists;

  IF NOT v_snapshot_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SNAPSHOT');
  END IF;

  -- Create DRAFT document
  INSERT INTO stock_documents (
    establishment_id, organization_id, storage_zone_id,
    type, status, created_by
  ) VALUES (
    p_establishment_id, p_organization_id, p_storage_zone_id,
    'ADJUSTMENT', 'DRAFT', p_user_id
  )
  RETURNING id, lock_version INTO v_doc_id, v_lock_version;

  -- Insert single line
  INSERT INTO stock_document_lines (
    document_id, product_id, delta_quantity_canonical,
    canonical_unit_id, canonical_family, canonical_label,
    context_hash, input_payload
  ) VALUES (
    v_doc_id, p_product_id, v_delta,
    p_canonical_unit_id, p_canonical_family, p_canonical_label,
    COALESCE(p_context_hash, 'rpc-adjustment'),
    jsonb_build_object(
      'targetQty', p_target_qty,
      'estimatedQty', p_estimated_qty,
      'delta', v_delta,
      'source', 'fn_quick_adjustment'
    )
  );

  -- POST via existing RPC within same transaction
  v_idempotency_key := md5(v_doc_id::text || p_establishment_id::text || v_lock_version::text);

  SELECT fn_post_stock_document(
    p_document_id := v_doc_id,
    p_expected_lock_version := v_lock_version,
    p_idempotency_key := v_idempotency_key,
    p_posted_by := p_user_id,
    p_event_reason := 'Correction manuelle (Centre de contrôle)',
    p_override_flag := false,
    p_override_reason := NULL
  ) INTO v_post_result;

  IF NOT (v_post_result->>'ok')::boolean THEN
    RAISE EXCEPTION 'POST_FAILED: %', v_post_result->>'error';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'document_id', v_doc_id,
    'delta', v_delta,
    'events_created', v_post_result->'events_created'
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- F5: fn_create_bl_withdrawal — Atomic BL Retrait creation
-- Number generation + doc + lines in one transaction
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_create_bl_withdrawal(
  p_establishment_id UUID,
  p_organization_id UUID,
  p_stock_document_id UUID,
  p_destination_establishment_id UUID DEFAULT NULL,
  p_destination_name TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
  v_bl_number TEXT;
  v_bl_id UUID;
  v_total NUMERIC := 0;
  v_line JSONB;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_line_total NUMERIC;
  v_canonical_unit_id UUID;
  v_fallback_unit_id UUID;
BEGIN
  -- Idempotence: check if BL already exists for this stock_document_id
  SELECT id, bl_number INTO v_existing
  FROM bl_withdrawal_documents
  WHERE stock_document_id = p_stock_document_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'bl_number', v_existing.bl_number);
  END IF;

  -- Generate sequential BL number
  SELECT fn_next_bl_withdrawal_number(p_establishment_id) INTO v_bl_number;

  -- Calculate total
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := ABS((v_line->>'quantity')::numeric);
    v_price := COALESCE((v_line->>'unit_price')::numeric, 0);
    v_line_total := ROUND(v_qty * v_price * 100) / 100;
    v_total := v_total + v_line_total;
  END LOOP;

  -- Insert document
  INSERT INTO bl_withdrawal_documents (
    establishment_id, organization_id, stock_document_id,
    bl_number, destination_establishment_id, destination_name,
    total_eur, created_by
  ) VALUES (
    p_establishment_id, p_organization_id, p_stock_document_id,
    v_bl_number, p_destination_establishment_id, p_destination_name,
    ROUND(v_total * 100) / 100, p_created_by
  )
  RETURNING id INTO v_bl_id;

  -- Insert lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := ABS((v_line->>'quantity')::numeric);
    v_price := COALESCE((v_line->>'unit_price')::numeric, 0);
    v_line_total := ROUND(v_qty * v_price * 100) / 100;
    
    v_canonical_unit_id := (v_line->>'canonical_unit_id')::uuid;
    
    -- Fallback: get unit from products_v2 if not provided
    IF v_canonical_unit_id IS NULL THEN
      SELECT stock_handling_unit_id INTO v_fallback_unit_id
      FROM products_v2
      WHERE id = (v_line->>'product_id')::uuid;
      v_canonical_unit_id := v_fallback_unit_id;
    END IF;

    -- Skip lines without valid unit
    IF v_canonical_unit_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO bl_withdrawal_lines (
      bl_withdrawal_document_id, product_id, product_name_snapshot,
      quantity_canonical, canonical_unit_id,
      unit_price_snapshot, line_total_snapshot
    ) VALUES (
      v_bl_id, (v_line->>'product_id')::uuid, v_line->>'product_name_snapshot',
      v_qty, v_canonical_unit_id,
      CASE WHEN v_price = 0 THEN NULL ELSE v_price END,
      CASE WHEN v_price = 0 THEN NULL ELSE v_line_total END
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'id', v_bl_id, 'bl_number', v_bl_number);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- F6: fn_correct_bl_withdrawal — Atomic correction: stock POST + BL update
-- Creates ADJUSTMENT doc + lines + POST + updates BL lines in one transaction
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_correct_bl_withdrawal(
  p_original_stock_document_id UUID,
  p_bl_retrait_document_id UUID,
  p_establishment_id UUID,
  p_organization_id UUID,
  p_storage_zone_id UUID,
  p_user_id UUID,
  p_lines JSONB -- array of {product_id, user_delta, canonical_unit_id, canonical_family, canonical_label, context_hash}
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orig_doc RECORD;
  v_doc_id UUID;
  v_lock_version INT;
  v_idempotency_key TEXT;
  v_post_result JSONB;
  v_line JSONB;
  v_stock_delta NUMERIC;
  v_user_delta NUMERIC;
  v_bl_line RECORD;
  v_new_qty NUMERIC;
  v_new_line_total NUMERIC;
  v_new_total NUMERIC := 0;
  v_events_created INT := 0;
BEGIN
  -- 1. Lock and verify original document
  SELECT id, type, status INTO v_orig_doc
  FROM stock_documents
  WHERE id = p_original_stock_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORIGINAL_NOT_FOUND');
  END IF;

  IF v_orig_doc.type != 'WITHDRAWAL' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_A_WITHDRAWAL');
  END IF;

  IF v_orig_doc.status != 'POSTED' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_POSTED');
  END IF;

  -- 2. Create DRAFT ADJUSTMENT document with corrects_document_id
  INSERT INTO stock_documents (
    establishment_id, organization_id, storage_zone_id,
    type, status, corrects_document_id, created_by
  ) VALUES (
    p_establishment_id, p_organization_id, p_storage_zone_id,
    'ADJUSTMENT', 'DRAFT', p_original_stock_document_id, p_user_id
  )
  RETURNING id, lock_version INTO v_doc_id, v_lock_version;

  -- 3. Insert delta lines (NEGATED: less withdrawn = more stock)
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_user_delta := (v_line->>'user_delta')::numeric;
    v_stock_delta := -v_user_delta; -- Negate for stock impact

    INSERT INTO stock_document_lines (
      document_id, product_id, delta_quantity_canonical,
      canonical_unit_id, canonical_family, canonical_label, context_hash
    ) VALUES (
      v_doc_id,
      (v_line->>'product_id')::uuid,
      v_stock_delta,
      (v_line->>'canonical_unit_id')::uuid,
      v_line->>'canonical_family',
      v_line->>'canonical_label',
      v_line->>'context_hash'
    );
  END LOOP;

  -- 4. POST via fn_post_stock_document (same transaction)
  v_idempotency_key := md5(v_doc_id::text || p_establishment_id::text || v_lock_version::text);

  SELECT fn_post_stock_document(
    p_document_id := v_doc_id,
    p_expected_lock_version := v_lock_version,
    p_idempotency_key := v_idempotency_key,
    p_posted_by := p_user_id,
    p_event_reason := 'WITHDRAWAL_CORRECTION',
    p_override_flag := false,
    p_override_reason := NULL
  ) INTO v_post_result;

  IF NOT (v_post_result->>'ok')::boolean THEN
    RAISE EXCEPTION 'POST_FAILED: %', v_post_result->>'error';
  END IF;

  v_events_created := COALESCE((v_post_result->>'events_created')::int, 0);

  -- 5. Update BL withdrawal lines to reflect corrected quantities
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_user_delta := (v_line->>'user_delta')::numeric;

    FOR v_bl_line IN
      SELECT id, quantity_canonical, unit_price_snapshot
      FROM bl_withdrawal_lines
      WHERE bl_withdrawal_document_id = p_bl_retrait_document_id
        AND product_id = (v_line->>'product_id')::uuid
    LOOP
      v_new_qty := ROUND((v_bl_line.quantity_canonical + v_user_delta) * 10000) / 10000;
      v_new_line_total := CASE
        WHEN v_bl_line.unit_price_snapshot IS NOT NULL
        THEN ROUND(v_new_qty * v_bl_line.unit_price_snapshot * 100) / 100
        ELSE NULL
      END;
      v_new_total := v_new_total + COALESCE(v_new_line_total, 0);

      UPDATE bl_withdrawal_lines
      SET quantity_canonical = v_new_qty,
          line_total_snapshot = v_new_line_total
      WHERE id = v_bl_line.id;
    END LOOP;
  END LOOP;

  -- 6. Update BL document total
  -- Recalculate from all lines to be safe
  SELECT COALESCE(SUM(COALESCE(line_total_snapshot, 0)), 0) INTO v_new_total
  FROM bl_withdrawal_lines
  WHERE bl_withdrawal_document_id = p_bl_retrait_document_id;

  UPDATE bl_withdrawal_documents
  SET total_eur = ROUND(v_new_total * 100) / 100
  WHERE id = p_bl_retrait_document_id;

  RETURN jsonb_build_object(
    'ok', true,
    'document_id', v_doc_id,
    'events_created', v_events_created
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- F8: Partial unique index — one active session per zone
-- ═══════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_sessions_one_active_per_zone
ON inventory_sessions (establishment_id, storage_zone_id)
WHERE status IN ('en_cours', 'en_pause');

-- ═══════════════════════════════════════════════════════════════
-- F9: Optimistic locking trigger for products_v2
-- Rejects updates if updated_at has changed since client read
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_products_v2_optimistic_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If the client sends an updated_at that doesn't match current,
  -- it means another write happened in between → reject
  -- The client MUST send the original updated_at in the UPDATE payload
  -- If updated_at is not being changed (same value), allow the update
  IF NEW.updated_at IS DISTINCT FROM OLD.updated_at 
     AND NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'OPTIMISTIC_LOCK_CONFLICT: Le produit a été modifié par un autre utilisateur. Veuillez rafraîchir et réessayer.'
      USING ERRCODE = '40001'; -- serialization_failure
  END IF;
  
  -- Force updated_at to now() for every update
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Only create trigger if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_products_v2_optimistic_lock'
  ) THEN
    CREATE TRIGGER trg_products_v2_optimistic_lock
      BEFORE UPDATE ON products_v2
      FOR EACH ROW
      EXECUTE FUNCTION trg_products_v2_optimistic_lock();
  END IF;
END;
$$;
