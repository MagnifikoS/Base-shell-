
-- ═══════════════════════════════════════════════════════════════
-- RESCUE V0 STEP 2: Discrepancy-aware B2B Reception
-- Only touches: product_orders columns + PL/pgSQL functions
-- Does NOT touch: stock_*, inventory_*, products_v2, measurement_units
-- ═══════════════════════════════════════════════════════════════

-- 1. Add discrepancy tracking columns
ALTER TABLE product_orders
  ADD COLUMN IF NOT EXISTS has_discrepancy boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discrepancy_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS discrepancy_validated_by uuid;

-- 2. Update transition guard: allow awaiting_client_validation → received, received → closed
CREATE OR REPLACE FUNCTION fn_trg_b2b_status_transition_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT fn_is_cross_org_order(NEW.id) THEN RETURN NEW; END IF;

  IF NOT (
    (OLD.status = 'draft' AND NEW.status = 'sent') OR
    (OLD.status = 'sent' AND NEW.status = 'preparing') OR
    (OLD.status = 'sent' AND NEW.status = 'prepared') OR
    (OLD.status = 'preparing' AND NEW.status = 'prepared') OR
    (OLD.status = 'prepared' AND NEW.status = 'shipped') OR
    (OLD.status = 'prepared' AND NEW.status = 'awaiting_client_validation') OR
    (OLD.status = 'shipped' AND NEW.status = 'awaiting_client_validation') OR
    (OLD.status = 'awaiting_client_validation' AND NEW.status = 'closed') OR
    (OLD.status = 'awaiting_client_validation' AND NEW.status = 'received') OR
    (OLD.status = 'received' AND NEW.status = 'closed') OR
    (OLD.status = 'shipped' AND NEW.status = 'prepared') OR
    (OLD.status = 'awaiting_client_validation' AND NEW.status = 'prepared') OR
    (OLD.status = 'sent' AND NEW.status = 'draft')
  ) THEN
    RAISE EXCEPTION 'B2B_TRANSITION_GUARD: Illegal cross-org status transition from "%" to "%" on order %', OLD.status, NEW.status, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Recreate fn_post_b2b_reception with p_has_discrepancy parameter
DROP FUNCTION IF EXISTS fn_post_b2b_reception(uuid, uuid, uuid, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.fn_post_b2b_reception(
  p_order_id uuid,
  p_client_establishment_id uuid,
  p_client_organization_id uuid,
  p_client_user_id uuid,
  p_validated_lines jsonb,
  p_has_discrepancy boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_bl_retrait RECORD;
  v_stock_doc RECORD;
  v_supplier_est RECORD;
  v_post_result JSONB;
  v_receipt_doc_id UUID;
  v_receipt_event_count INT := 0;
  v_bl_reception_id UUID;
  v_client_header_zone_id UUID;
  v_line JSONB;
  v_line_count INT := 0;
  v_total_eur NUMERIC(12,2) := 0;
  v_updated_lines INT := 0;
  v_idempotency_key TEXT;
  v_existing_receipt_id UUID;
  v_invoice_number TEXT;
  v_invoice_date DATE;
  v_supplier_supplier_id UUID;
  v_client_supplier_id UUID;
  v_invoice_warning TEXT := NULL;
  v_sc_record RECORD;
  v_missing_zone_products JSONB;
  v_missing_snapshot_zones JSONB;
  v_dest_est_name TEXT;
  v_client_est_name TEXT;
  v_vat_result JSONB;
  v_supplier_already_posted BOOLEAN := false;
BEGIN
  v_idempotency_key := 'b2b-receipt-' || p_order_id::text;

  -- ═══ PHASE A: VALIDATIONS ═══

  SELECT id INTO v_existing_receipt_id
  FROM stock_documents
  WHERE idempotency_key = v_idempotency_key
    AND establishment_id = p_client_establishment_id
    AND status = 'POSTED'
  LIMIT 1;

  IF v_existing_receipt_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'receipt_document_id', v_existing_receipt_id);
  END IF;

  DELETE FROM stock_document_lines
  WHERE document_id IN (
    SELECT id FROM stock_documents
    WHERE idempotency_key = v_idempotency_key
      AND establishment_id = p_client_establishment_id
      AND status = 'DRAFT'
  );
  DELETE FROM stock_documents
  WHERE idempotency_key = v_idempotency_key
    AND establishment_id = p_client_establishment_id
    AND status = 'DRAFT';

  SELECT * INTO v_order FROM product_orders WHERE id = p_order_id;
  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  IF v_order.status != 'awaiting_client_validation' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATUS', 'current_status', v_order.status);
  END IF;
  IF v_order.source_establishment_id != p_client_establishment_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_CLIENT_ESTABLISHMENT');
  END IF;

  IF v_order.bl_retrait_document_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_BL_RETRAIT');
  END IF;
  SELECT * INTO v_bl_retrait FROM bl_withdrawal_documents WHERE id = v_order.bl_retrait_document_id;
  IF v_bl_retrait IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BL_RETRAIT_NOT_FOUND');
  END IF;

  SELECT * INTO v_stock_doc FROM stock_documents WHERE id = v_bl_retrait.stock_document_id;
  IF v_stock_doc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STOCK_DOC_NOT_FOUND');
  END IF;
  IF v_stock_doc.status NOT IN ('DRAFT', 'POSTED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STOCK_DOC_INVALID_STATUS', 'current_status', v_stock_doc.status);
  END IF;

  v_supplier_already_posted := (v_stock_doc.status = 'POSTED');

  SELECT id, organization_id, name INTO v_supplier_est
  FROM establishments WHERE id = v_order.destination_establishment_id;
  v_dest_est_name := v_supplier_est.name;
  SELECT name INTO v_client_est_name FROM establishments WHERE id = p_client_establishment_id;

  -- GUARD 6: Validate client zones & snapshots
  SELECT p.storage_zone_id INTO v_client_header_zone_id
  FROM jsonb_array_elements(p_validated_lines) AS jl
  JOIN products_v2 p ON p.id = (jl->>'client_product_id')::UUID
  WHERE p.storage_zone_id IS NOT NULL
  LIMIT 1;

  IF v_client_header_zone_id IS NULL THEN
    SELECT sz.id INTO v_client_header_zone_id
    FROM storage_zones sz
    WHERE sz.establishment_id = p_client_establishment_id AND sz.is_active = true
    ORDER BY sz.display_order
    LIMIT 1;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', (jl->>'client_product_id')::UUID)), '[]'::jsonb)
  INTO v_missing_zone_products
  FROM jsonb_array_elements(p_validated_lines) AS jl
  JOIN products_v2 p ON p.id = (jl->>'client_product_id')::UUID
  WHERE p.storage_zone_id IS NULL;

  IF v_missing_zone_products != '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_PRODUCT_NO_ZONE', 'products', v_missing_zone_products);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('zone_id', missing.product_zone_id)), '[]'::jsonb)
  INTO v_missing_snapshot_zones
  FROM (
    SELECT DISTINCT p.storage_zone_id AS product_zone_id
    FROM jsonb_array_elements(p_validated_lines) AS jl
    JOIN products_v2 p ON p.id = (jl->>'client_product_id')::UUID
  ) missing
  WHERE NOT EXISTS (
    SELECT 1 FROM zone_stock_snapshots zss
    WHERE zss.establishment_id = p_client_establishment_id
      AND zss.storage_zone_id = missing.product_zone_id
  );

  IF v_missing_snapshot_zones != '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_CLIENT_SNAPSHOT_FOR_PRODUCT_ZONE', 'zones', v_missing_snapshot_zones);
  END IF;

  -- ═══ PHASE B: MUTATIONS ═══

  -- STEP 1: Post supplier withdrawal (SKIP if already POSTED)
  IF NOT v_supplier_already_posted THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_validated_lines)
    LOOP
      UPDATE stock_document_lines
      SET delta_quantity_canonical = -1 * ABS((v_line->>'quantity_canonical')::NUMERIC)
      WHERE document_id = v_stock_doc.id
        AND product_id = (v_line->>'supplier_product_id')::UUID;
      GET DIAGNOSTICS v_updated_lines = ROW_COUNT;
    END LOOP;

    v_post_result := fn_post_stock_document(
      p_document_id := v_stock_doc.id,
      p_expected_lock_version := v_stock_doc.lock_version,
      p_idempotency_key := 'b2b-reception-' || p_order_id::text || '-' || v_stock_doc.lock_version::text,
      p_posted_by := p_client_user_id,
      p_event_reason := 'INTER_ESTABLISHMENT_TRANSFER',
      p_override_flag := false,
      p_override_reason := NULL
    );
    IF NOT (v_post_result->>'ok')::boolean THEN
      RETURN jsonb_build_object('ok', false, 'error', 'SUPPLIER_POST_FAILED', 'details', v_post_result);
    END IF;
  ELSE
    v_post_result := jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_posted_at_ship');
  END IF;

  -- STEP 2: Rebuild BL withdrawal lines — ONLY if no discrepancy (preserve original shipped quantities)
  IF NOT p_has_discrepancy THEN
    DELETE FROM bl_withdrawal_lines WHERE bl_withdrawal_document_id = v_bl_retrait.id;
    v_total_eur := 0;
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_validated_lines)
    LOOP
      INSERT INTO bl_withdrawal_lines (
        bl_withdrawal_document_id, product_id, product_name_snapshot,
        quantity_canonical, canonical_unit_id, unit_price_snapshot, line_total_snapshot
      ) VALUES (
        v_bl_retrait.id,
        (v_line->>'supplier_product_id')::UUID,
        COALESCE(v_line->>'product_name_snapshot', ''),
        (v_line->>'quantity_canonical')::NUMERIC,
        (v_line->>'supplier_canonical_unit_id')::UUID,
        CASE WHEN v_line->>'unit_price' IS NOT NULL THEN (v_line->>'unit_price')::NUMERIC ELSE NULL END,
        CASE WHEN v_line->>'line_total' IS NOT NULL THEN (v_line->>'line_total')::NUMERIC ELSE NULL END
      );
      v_total_eur := v_total_eur + COALESCE((v_line->>'line_total')::NUMERIC, 0);
      v_line_count := v_line_count + 1;
    END LOOP;
    UPDATE bl_withdrawal_documents SET total_eur = ROUND(v_total_eur, 2) WHERE id = v_bl_retrait.id;
  ELSE
    -- Discrepancy: compute total from validated (received) lines for the return object
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_validated_lines)
    LOOP
      v_total_eur := v_total_eur + COALESCE((v_line->>'line_total')::NUMERIC, 0);
      v_line_count := v_line_count + 1;
    END LOOP;
  END IF;

  -- STEP 3: Create client RECEIPT (POSTED directly)
  INSERT INTO stock_documents (
    establishment_id, organization_id, type, status,
    storage_zone_id, created_by, idempotency_key,
    posted_by, posted_at, lock_version
  ) VALUES (
    p_client_establishment_id, p_client_organization_id, 'RECEIPT', 'POSTED',
    v_client_header_zone_id, p_client_user_id,
    v_idempotency_key,
    p_client_user_id, now(), 2
  ) RETURNING id INTO v_receipt_doc_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_validated_lines)
  LOOP
    INSERT INTO stock_document_lines (
      document_id, product_id, delta_quantity_canonical,
      canonical_unit_id, canonical_family, context_hash
    ) VALUES (
      v_receipt_doc_id,
      (v_line->>'client_product_id')::UUID,
      ABS((v_line->>'quantity_canonical')::NUMERIC),
      (v_line->>'client_canonical_unit_id')::UUID,
      COALESCE(v_line->>'client_canonical_family', 'count'),
      v_line->>'client_context_hash'
    );
  END LOOP;

  -- STEP 4: Create stock events for client receipt
  INSERT INTO stock_events (
    establishment_id, organization_id, storage_zone_id, product_id,
    document_id, event_type, event_reason,
    delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label,
    context_hash, snapshot_version_id,
    override_flag, override_reason, posted_by
  )
  SELECT
    p_client_establishment_id,
    p_client_organization_id,
    p.storage_zone_id,
    dl.product_id,
    v_receipt_doc_id,
    'RECEIPT'::stock_event_type,
    'INTER_ESTABLISHMENT_TRANSFER',
    dl.delta_quantity_canonical,
    dl.canonical_unit_id,
    dl.canonical_family,
    COALESCE(dl.canonical_label, ''),
    dl.context_hash,
    zss.snapshot_version_id,
    false,
    NULL,
    p_client_user_id
  FROM stock_document_lines dl
  JOIN products_v2 p ON p.id = dl.product_id
  JOIN zone_stock_snapshots zss
    ON zss.establishment_id = p_client_establishment_id
    AND zss.storage_zone_id = p.storage_zone_id
  WHERE dl.document_id = v_receipt_doc_id;

  GET DIAGNOSTICS v_receipt_event_count = ROW_COUNT;

  -- STEP 5: Create BL reception document
  INSERT INTO bl_app_documents (
    establishment_id, stock_document_id, status, bl_date,
    supplier_id, supplier_name_snapshot, created_by
  ) VALUES (
    p_client_establishment_id, v_receipt_doc_id, 'FINAL',
    (now() AT TIME ZONE 'Europe/Paris')::date,
    NULL,
    v_dest_est_name,
    p_client_user_id
  ) RETURNING id INTO v_bl_reception_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_validated_lines)
  LOOP
    INSERT INTO bl_app_lines (
      bl_app_document_id, establishment_id, product_id,
      product_name_snapshot, quantity_canonical, canonical_unit_id,
      unit_price, line_total
    ) VALUES (
      v_bl_reception_id, p_client_establishment_id,
      (v_line->>'client_product_id')::UUID,
      COALESCE(v_line->>'product_name_snapshot', ''),
      (v_line->>'quantity_canonical')::NUMERIC,
      (v_line->>'client_canonical_unit_id')::UUID,
      CASE WHEN v_line->>'unit_price' IS NOT NULL THEN (v_line->>'unit_price')::NUMERIC ELSE NULL END,
      CASE WHEN v_line->>'line_total' IS NOT NULL THEN (v_line->>'line_total')::NUMERIC ELSE NULL END
    );
  END LOOP;

  -- STEP 6: Update order status + received quantities
  IF p_has_discrepancy THEN
    UPDATE product_orders
    SET status = 'received',
        has_discrepancy = true,
        bl_reception_document_id = v_bl_reception_id
    WHERE id = p_order_id;
  ELSE
    UPDATE product_orders
    SET status = 'closed',
        bl_reception_document_id = v_bl_reception_id
    WHERE id = p_order_id;
  END IF;

  UPDATE product_order_lines pol SET
    quantity_received = ABS((jl->>'quantity_canonical')::NUMERIC)
  FROM jsonb_array_elements(p_validated_lines) AS jl
  WHERE pol.order_id = p_order_id
    AND pol.product_id = (jl->>'client_product_id')::UUID;

  -- STEP 7: Generate B2B invoices — ONLY if no discrepancy
  IF NOT p_has_discrepancy THEN
    BEGIN
      IF EXISTS (SELECT 1 FROM invoices WHERE b2b_order_id = p_order_id LIMIT 1) THEN
        v_invoice_warning := NULL;
      ELSE
        v_invoice_number := 'FAC-B2B-' || SUBSTRING(p_order_id::text FROM 1 FOR 8);
        v_invoice_date := (now() AT TIME ZONE 'Europe/Paris')::date;

        SELECT * INTO v_sc_record
        FROM supplier_clients
        WHERE supplier_establishment_id = v_order.destination_establishment_id
          AND client_establishment_id = p_client_establishment_id
          AND status = 'active'
        LIMIT 1;

        SELECT id INTO v_client_supplier_id
        FROM invoice_suppliers
        WHERE establishment_id = p_client_establishment_id
          AND partner_establishment_id = v_order.destination_establishment_id
        LIMIT 1;

        IF v_client_supplier_id IS NULL AND v_sc_record IS NOT NULL THEN
          INSERT INTO invoice_suppliers (
            establishment_id, organization_id, name, status,
            partner_establishment_id, supplier_type
          ) VALUES (
            p_client_establishment_id, p_client_organization_id,
            v_dest_est_name, 'active', v_order.destination_establishment_id, 'b2b'
          ) RETURNING id INTO v_client_supplier_id;
        END IF;

        SELECT id INTO v_supplier_supplier_id
        FROM invoice_suppliers
        WHERE establishment_id = v_order.destination_establishment_id
          AND partner_establishment_id = p_client_establishment_id
        LIMIT 1;

        IF v_supplier_supplier_id IS NULL AND v_sc_record IS NOT NULL THEN
          INSERT INTO invoice_suppliers (
            establishment_id, organization_id, name, status,
            partner_establishment_id, supplier_type
          ) VALUES (
            v_order.destination_establishment_id, v_supplier_est.organization_id,
            v_client_est_name, 'active', p_client_establishment_id, 'b2b'
          ) RETURNING id INTO v_supplier_supplier_id;
        END IF;

        IF v_supplier_supplier_id IS NOT NULL THEN
          INSERT INTO invoices (
            establishment_id, organization_id, supplier_id,
            supplier_name, invoice_number, invoice_date, amount_eur,
            file_path, file_name, file_size, file_type,
            created_by, b2b_order_id, b2b_status
          ) VALUES (
            v_order.destination_establishment_id, v_supplier_est.organization_id,
            v_supplier_supplier_id, v_client_est_name,
            v_invoice_number, v_invoice_date, ROUND(v_total_eur, 2),
            'b2b/auto', 'facture-b2b-auto', 0, 'b2b',
            p_client_user_id, p_order_id, 'issued'
          );
        ELSE
          v_invoice_warning := COALESCE(v_invoice_warning, '') || 'SUPPLIER_INVOICE_SKIPPED:NO_SUPPLIER_RECORD;';
        END IF;

        IF v_client_supplier_id IS NOT NULL THEN
          INSERT INTO invoices (
            establishment_id, organization_id, supplier_id,
            supplier_name, invoice_number, invoice_date, amount_eur,
            file_path, file_name, file_size, file_type,
            created_by, b2b_order_id, b2b_status
          ) VALUES (
            p_client_establishment_id, p_client_organization_id,
            v_client_supplier_id, v_dest_est_name,
            v_invoice_number, v_invoice_date, ROUND(v_total_eur, 2),
            'b2b/auto', 'facture-b2b-auto', 0, 'b2b',
            p_client_user_id, p_order_id, 'received'
          );
        ELSE
          v_invoice_warning := COALESCE(v_invoice_warning, '') || 'CLIENT_INVOICE_SKIPPED:NO_SUPPLIER_RECORD;';
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_invoice_warning := 'INVOICE_GENERATION_FAILED:' || SQLERRM || ' [' || SQLSTATE || ']';
      INSERT INTO audit_logs (
        organization_id, action, target_type, target_id, user_id, metadata
      ) VALUES (
        p_client_organization_id, 'b2b_invoice_generation_failed', 'product_order', p_order_id, p_client_user_id,
        jsonb_build_object('error', SQLERRM, 'sqlstate', SQLSTATE, 'order_id', p_order_id)
      );
    END;
  END IF;

  -- STEP 8: TVA enrichment — ONLY if no discrepancy
  IF NOT p_has_discrepancy THEN
    BEGIN
      v_vat_result := fn_enrich_b2b_invoices_vat_fr(p_order_id);
    EXCEPTION WHEN OTHERS THEN
      v_vat_result := jsonb_build_object('ok', false, 'error', SQLERRM);
      INSERT INTO audit_logs (
        organization_id, action, target_type, target_id, user_id, metadata
      ) VALUES (
        p_client_organization_id, 'b2b_vat_enrichment_failed', 'product_order', p_order_id, p_client_user_id,
        jsonb_build_object('error', SQLERRM, 'sqlstate', SQLSTATE, 'order_id', p_order_id)
      );
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'has_discrepancy', p_has_discrepancy,
    'supplier_post', v_post_result,
    'supplier_already_posted', v_supplier_already_posted,
    'receipt_document_id', v_receipt_doc_id,
    'bl_reception_id', v_bl_reception_id,
    'receipt_events_created', v_receipt_event_count,
    'lines_processed', v_line_count,
    'invoice_warning', v_invoice_warning,
    'vat_result', v_vat_result
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$function$;

-- ═══ 4. Create fn_validate_b2b_discrepancy (supplier validates discrepancy) ═══
CREATE OR REPLACE FUNCTION public.fn_validate_b2b_discrepancy(
  p_order_id uuid,
  p_supplier_user_id uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_bl_retrait RECORD;
  v_stock_doc RECORD;
  v_supplier_est RECORD;
  v_adj_doc_id UUID;
  v_adj_idempotency TEXT;
  v_adj_already_done BOOLEAN := false;
  v_post_result JSONB;
  v_total_received_eur NUMERIC(12,2) := 0;
  v_invoice_warning TEXT := NULL;
  v_invoice_number TEXT;
  v_invoice_date DATE;
  v_supplier_supplier_id UUID;
  v_client_supplier_id UUID;
  v_sc_record RECORD;
  v_dest_est_name TEXT;
  v_client_est_name TEXT;
  v_bl_reception_id UUID;
  v_vat_result JSONB;
  v_lines_corrected INT := 0;
  v_delta_rec RECORD;
BEGIN
  -- ═══ GUARD 1: Validate order state ═══
  SELECT * INTO v_order FROM product_orders WHERE id = p_order_id;
  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  IF v_order.status != 'received' OR v_order.has_discrepancy != true THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATE',
      'current_status', v_order.status, 'has_discrepancy', v_order.has_discrepancy);
  END IF;

  -- ═══ GUARD 2: Get BL retrait + stock doc ═══
  IF v_order.bl_retrait_document_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_BL_RETRAIT');
  END IF;
  SELECT * INTO v_bl_retrait FROM bl_withdrawal_documents WHERE id = v_order.bl_retrait_document_id;
  IF v_bl_retrait IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BL_RETRAIT_NOT_FOUND');
  END IF;
  SELECT * INTO v_stock_doc FROM stock_documents WHERE id = v_bl_retrait.stock_document_id;
  IF v_stock_doc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STOCK_DOC_NOT_FOUND');
  END IF;

  v_bl_reception_id := v_order.bl_reception_document_id;
  IF v_bl_reception_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_BL_RECEPTION');
  END IF;

  SELECT id, organization_id, name INTO v_supplier_est
  FROM establishments WHERE id = v_order.destination_establishment_id;
  v_dest_est_name := v_supplier_est.name;
  SELECT name INTO v_client_est_name FROM establishments WHERE id = v_order.source_establishment_id;

  -- ═══ STEP 1: Stock correction (reintegrate delta to supplier) ═══
  v_adj_idempotency := 'b2b-discrepancy-adj-' || p_order_id::text;

  -- Idempotency check
  IF EXISTS (
    SELECT 1 FROM stock_documents
    WHERE idempotency_key = v_adj_idempotency AND status = 'POSTED'
  ) THEN
    v_adj_already_done := true;
  ELSE
    -- Clean orphan drafts
    DELETE FROM stock_document_lines WHERE document_id IN (
      SELECT id FROM stock_documents WHERE idempotency_key = v_adj_idempotency AND status = 'DRAFT'
    );
    DELETE FROM stock_documents WHERE idempotency_key = v_adj_idempotency AND status = 'DRAFT';

    -- Create adjustment document
    INSERT INTO stock_documents (
      establishment_id, organization_id, type, status,
      storage_zone_id, created_by, idempotency_key,
      corrects_document_id, lock_version
    ) VALUES (
      v_order.destination_establishment_id, v_supplier_est.organization_id,
      'ADJUSTMENT', 'DRAFT',
      v_stock_doc.storage_zone_id, p_supplier_user_id,
      v_adj_idempotency,
      v_stock_doc.id, 1
    ) RETURNING id INTO v_adj_doc_id;

    -- Insert correction lines: delta = shipped - received (positive = reintegration)
    FOR v_delta_rec IN
      SELECT
        bwl.product_id as supplier_product_id,
        bwl.quantity_canonical as shipped_qty,
        COALESCE(bal.quantity_canonical, 0) as received_qty,
        bwl.quantity_canonical - COALESCE(bal.quantity_canonical, 0) as delta,
        sdl.canonical_unit_id,
        sdl.canonical_family,
        COALESCE(sdl.canonical_label, '') as canonical_label,
        sdl.context_hash
      FROM bl_withdrawal_lines bwl
      JOIN stock_document_lines sdl
        ON sdl.product_id = bwl.product_id AND sdl.document_id = v_stock_doc.id
      LEFT JOIN product_order_lines pol
        ON pol.resolved_supplier_product_id = bwl.product_id AND pol.order_id = p_order_id
      LEFT JOIN bl_app_lines bal
        ON bal.product_id = pol.product_id AND bal.bl_app_document_id = v_bl_reception_id
      WHERE bwl.bl_withdrawal_document_id = v_order.bl_retrait_document_id
    LOOP
      IF ABS(v_delta_rec.delta) > 0.001 THEN
        INSERT INTO stock_document_lines (
          document_id, product_id, delta_quantity_canonical,
          canonical_unit_id, canonical_family, canonical_label, context_hash
        ) VALUES (
          v_adj_doc_id,
          v_delta_rec.supplier_product_id,
          v_delta_rec.delta,  -- positive = reintegrate, negative = additional deduction
          v_delta_rec.canonical_unit_id,
          v_delta_rec.canonical_family,
          v_delta_rec.canonical_label,
          v_delta_rec.context_hash
        );
        v_lines_corrected := v_lines_corrected + 1;
      END IF;
    END LOOP;

    -- Post the adjustment if there are lines
    IF v_lines_corrected > 0 THEN
      v_post_result := fn_post_stock_document(
        p_document_id := v_adj_doc_id,
        p_expected_lock_version := 1,
        p_idempotency_key := v_adj_idempotency,
        p_posted_by := p_supplier_user_id,
        p_event_reason := 'WITHDRAWAL_CORRECTION',
        p_override_flag := false,
        p_override_reason := NULL
      );
      IF NOT (v_post_result->>'ok')::boolean THEN
        RETURN jsonb_build_object('ok', false, 'error', 'ADJUSTMENT_POST_FAILED', 'details', v_post_result);
      END IF;
    ELSE
      -- No actual deltas, clean up empty doc
      DELETE FROM stock_documents WHERE id = v_adj_doc_id;
    END IF;
  END IF;

  -- ═══ STEP 2: Update BL retrait lines to received quantities ═══
  UPDATE bl_withdrawal_lines bwl
  SET quantity_canonical = COALESCE(bal.quantity_canonical, 0),
      line_total_snapshot = CASE
        WHEN bwl.unit_price_snapshot IS NOT NULL
        THEN ROUND(COALESCE(bal.quantity_canonical, 0) * bwl.unit_price_snapshot, 2)
        ELSE NULL
      END
  FROM product_order_lines pol
  JOIN bl_app_lines bal
    ON bal.product_id = pol.product_id AND bal.bl_app_document_id = v_bl_reception_id
  WHERE bwl.bl_withdrawal_document_id = v_order.bl_retrait_document_id
    AND bwl.product_id = pol.resolved_supplier_product_id
    AND pol.order_id = p_order_id;

  UPDATE bl_withdrawal_documents
  SET total_eur = (
    SELECT COALESCE(SUM(COALESCE(line_total_snapshot, 0)), 0)
    FROM bl_withdrawal_lines
    WHERE bl_withdrawal_document_id = v_order.bl_retrait_document_id
  )
  WHERE id = v_order.bl_retrait_document_id;

  -- ═══ STEP 3: Generate invoices based on received quantities ═══
  SELECT COALESCE(SUM(COALESCE(line_total, 0)), 0) INTO v_total_received_eur
  FROM bl_app_lines WHERE bl_app_document_id = v_bl_reception_id;

  BEGIN
    IF EXISTS (SELECT 1 FROM invoices WHERE b2b_order_id = p_order_id LIMIT 1) THEN
      v_invoice_warning := NULL;
    ELSE
      v_invoice_number := 'FAC-B2B-' || SUBSTRING(p_order_id::text FROM 1 FOR 8);
      v_invoice_date := (now() AT TIME ZONE 'Europe/Paris')::date;

      SELECT * INTO v_sc_record
      FROM supplier_clients
      WHERE supplier_establishment_id = v_order.destination_establishment_id
        AND client_establishment_id = v_order.source_establishment_id
        AND status = 'active'
      LIMIT 1;

      SELECT id INTO v_client_supplier_id
      FROM invoice_suppliers
      WHERE establishment_id = v_order.source_establishment_id
        AND partner_establishment_id = v_order.destination_establishment_id
      LIMIT 1;

      IF v_client_supplier_id IS NULL AND v_sc_record IS NOT NULL THEN
        INSERT INTO invoice_suppliers (
          establishment_id, organization_id, name, status,
          partner_establishment_id, supplier_type
        ) VALUES (
          v_order.source_establishment_id, v_order.organization_id,
          v_dest_est_name, 'active', v_order.destination_establishment_id, 'b2b'
        ) RETURNING id INTO v_client_supplier_id;
      END IF;

      SELECT id INTO v_supplier_supplier_id
      FROM invoice_suppliers
      WHERE establishment_id = v_order.destination_establishment_id
        AND partner_establishment_id = v_order.source_establishment_id
      LIMIT 1;

      IF v_supplier_supplier_id IS NULL AND v_sc_record IS NOT NULL THEN
        INSERT INTO invoice_suppliers (
          establishment_id, organization_id, name, status,
          partner_establishment_id, supplier_type
        ) VALUES (
          v_order.destination_establishment_id, v_supplier_est.organization_id,
          v_client_est_name, 'active', v_order.source_establishment_id, 'b2b'
        ) RETURNING id INTO v_supplier_supplier_id;
      END IF;

      IF v_supplier_supplier_id IS NOT NULL THEN
        INSERT INTO invoices (
          establishment_id, organization_id, supplier_id,
          supplier_name, invoice_number, invoice_date, amount_eur,
          file_path, file_name, file_size, file_type,
          created_by, b2b_order_id, b2b_status
        ) VALUES (
          v_order.destination_establishment_id, v_supplier_est.organization_id,
          v_supplier_supplier_id, v_client_est_name,
          v_invoice_number, v_invoice_date, ROUND(v_total_received_eur, 2),
          'b2b/auto', 'facture-b2b-auto', 0, 'b2b',
          p_supplier_user_id, p_order_id, 'issued'
        );
      ELSE
        v_invoice_warning := COALESCE(v_invoice_warning, '') || 'SUPPLIER_INVOICE_SKIPPED;';
      END IF;

      IF v_client_supplier_id IS NOT NULL THEN
        INSERT INTO invoices (
          establishment_id, organization_id, supplier_id,
          supplier_name, invoice_number, invoice_date, amount_eur,
          file_path, file_name, file_size, file_type,
          created_by, b2b_order_id, b2b_status
        ) VALUES (
          v_order.source_establishment_id, v_order.organization_id,
          v_client_supplier_id, v_dest_est_name,
          v_invoice_number, v_invoice_date, ROUND(v_total_received_eur, 2),
          'b2b/auto', 'facture-b2b-auto', 0, 'b2b',
          p_supplier_user_id, p_order_id, 'received'
        );
      ELSE
        v_invoice_warning := COALESCE(v_invoice_warning, '') || 'CLIENT_INVOICE_SKIPPED;';
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_invoice_warning := 'INVOICE_FAILED:' || SQLERRM;
    INSERT INTO audit_logs (
      organization_id, action, target_type, target_id, user_id, metadata
    ) VALUES (
      v_supplier_est.organization_id, 'b2b_discrepancy_invoice_failed', 'product_order', p_order_id, p_supplier_user_id,
      jsonb_build_object('error', SQLERRM, 'sqlstate', SQLSTATE)
    );
  END;

  -- TVA enrichment
  BEGIN
    v_vat_result := fn_enrich_b2b_invoices_vat_fr(p_order_id);
  EXCEPTION WHEN OTHERS THEN
    v_vat_result := jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  -- ═══ STEP 4: Close order ═══
  UPDATE product_orders
  SET status = 'closed',
      discrepancy_validated_at = now(),
      discrepancy_validated_by = p_supplier_user_id
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'ok', true,
    'adjustment_already_done', v_adj_already_done,
    'adjustment_document_id', v_adj_doc_id,
    'lines_corrected', v_lines_corrected,
    'total_received_eur', ROUND(v_total_received_eur, 2),
    'invoice_warning', v_invoice_warning,
    'vat_result', v_vat_result
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$function$;
