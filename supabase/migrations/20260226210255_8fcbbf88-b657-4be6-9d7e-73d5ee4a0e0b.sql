
-- ═══════════════════════════════════════════════════════════════════════════
-- FIX P0: fn_post_b2b_reception — Two critical bugs:
-- 1. snapshot_version_id uses zone_stock_snapshots.id instead of .snapshot_version_id
--    → FK violation on stock_events_snapshot_version_id_fkey (references inventory_sessions)
-- 2. All events routed to header zone instead of per-product zone
--    → Must match fn_post_stock_document behavior (JOIN products_v2 + zone_stock_snapshots)
-- Impact: ZERO on intra-org AMIR. fn_post_stock_document unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_post_b2b_reception(
  p_order_id uuid,
  p_client_establishment_id uuid,
  p_client_organization_id uuid,
  p_client_user_id uuid,
  p_validated_lines jsonb
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
BEGIN
  v_idempotency_key := 'b2b-receipt-' || p_order_id::text;

  -- ═══ GUARD 1: Idempotency — already processed? ═══
  SELECT id INTO v_existing_receipt_id
  FROM stock_documents
  WHERE idempotency_key = v_idempotency_key
    AND establishment_id = p_client_establishment_id
    AND status = 'POSTED'
  LIMIT 1;

  IF v_existing_receipt_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'receipt_document_id', v_existing_receipt_id
    );
  END IF;

  -- ═══ GUARD 2: Clean orphan DRAFT from previous failed attempt ═══
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

  -- ═══ GUARD 3: Validate order ═══
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

  -- ═══ GUARD 4: Validate BL Retrait ═══
  IF v_order.bl_retrait_document_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_BL_RETRAIT');
  END IF;
  SELECT * INTO v_bl_retrait FROM bl_withdrawal_documents WHERE id = v_order.bl_retrait_document_id;
  IF v_bl_retrait IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BL_RETRAIT_NOT_FOUND');
  END IF;

  -- ═══ GUARD 5: Validate supplier stock document is still DRAFT ═══
  SELECT * INTO v_stock_doc FROM stock_documents WHERE id = v_bl_retrait.stock_document_id;
  IF v_stock_doc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STOCK_DOC_NOT_FOUND');
  END IF;
  IF v_stock_doc.status != 'DRAFT' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STOCK_DOC_NOT_DRAFT', 'current_status', v_stock_doc.status);
  END IF;

  SELECT id, organization_id INTO v_supplier_est FROM establishments WHERE id = v_order.destination_establishment_id;

  -- ═══ STEP 1: Update supplier draft lines with validated quantities ═══
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_validated_lines)
  LOOP
    UPDATE stock_document_lines
    SET delta_quantity_canonical = -1 * ABS((v_line->>'quantity_canonical')::NUMERIC)
    WHERE document_id = v_stock_doc.id
      AND product_id = (v_line->>'supplier_product_id')::UUID;
    GET DIAGNOSTICS v_updated_lines = ROW_COUNT;
  END LOOP;

  -- ═══ STEP 2: Post supplier withdrawal via fn_post_stock_document ═══
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

  -- ═══ STEP 3: Rebuild BL withdrawal lines with validated quantities ═══
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

  -- ═══ STEP 4: Resolve client header zone (for document only) ═══
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

  -- ═══ STEP 5: Validate ALL client products have zones + snapshots ═══
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', (jl->>'client_product_id')::UUID
  )), '[]'::jsonb)
  INTO v_missing_zone_products
  FROM jsonb_array_elements(p_validated_lines) AS jl
  JOIN products_v2 p ON p.id = (jl->>'client_product_id')::UUID
  WHERE p.storage_zone_id IS NULL;

  IF v_missing_zone_products != '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_PRODUCT_NO_ZONE', 'products', v_missing_zone_products);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'zone_id', missing.product_zone_id
  )), '[]'::jsonb)
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

  -- ═══ STEP 6: Create client RECEIPT directly as POSTED (bypass DRAFT) ═══
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

  -- ═══ STEP 7: Create stock_document_lines for audit trail ═══
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

  -- ═══ STEP 8: Create stock_events — PER-PRODUCT ZONE ROUTING ═══
  -- FIX 1: Use zss.snapshot_version_id (→ inventory_sessions.id), NOT zss.id
  -- FIX 2: Route each event to p.storage_zone_id (product zone), NOT header zone
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
    p.storage_zone_id,                -- FIX 2: per-product zone (not header zone)
    dl.product_id,
    v_receipt_doc_id,
    'RECEIPT'::stock_event_type,
    'INTER_ESTABLISHMENT_TRANSFER',
    dl.delta_quantity_canonical,
    dl.canonical_unit_id,
    dl.canonical_family,
    COALESCE(dl.canonical_label, ''),
    dl.context_hash,
    zss.snapshot_version_id,          -- FIX 1: inventory_session_id (not zone_snapshot_id)
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

  -- ═══ STEP 9: Create BL Réception ═══
  INSERT INTO bl_app_documents (
    establishment_id, stock_document_id, status, bl_date,
    supplier_id, supplier_name_snapshot, created_by
  ) VALUES (
    p_client_establishment_id, v_receipt_doc_id, 'completed',
    (now() AT TIME ZONE 'Europe/Paris')::date,
    NULL,
    (SELECT name FROM establishments WHERE id = v_order.destination_establishment_id),
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

  -- ═══ STEP 10: Close order + update received quantities ═══
  UPDATE product_orders SET status = 'closed' WHERE id = p_order_id;

  UPDATE product_order_lines pol SET
    quantity_received = ABS((jl->>'quantity_canonical')::NUMERIC)
  FROM jsonb_array_elements(p_validated_lines) AS jl
  WHERE pol.order_id = p_order_id
    AND pol.product_id = (jl->>'client_product_id')::UUID;

  -- ═══ STEP 11: Generate B2B invoices (non-blocking) ═══
  BEGIN
    IF EXISTS (SELECT 1 FROM invoices WHERE b2b_order_id = p_order_id LIMIT 1) THEN
      NULL;
    ELSE
      v_invoice_number := REPLACE(v_bl_retrait.bl_number, 'BL', 'FAC');
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
          (SELECT name FROM establishments WHERE id = v_order.destination_establishment_id),
          'active', v_order.destination_establishment_id, 'b2b'
        )
        ON CONFLICT (establishment_id, name) DO UPDATE SET
          partner_establishment_id = EXCLUDED.partner_establishment_id,
          supplier_type = 'b2b'
        RETURNING id INTO v_client_supplier_id;
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
          (SELECT name FROM establishments WHERE id = p_client_establishment_id),
          'active', p_client_establishment_id, 'b2b'
        )
        ON CONFLICT (establishment_id, name) DO UPDATE SET
          partner_establishment_id = EXCLUDED.partner_establishment_id,
          supplier_type = 'b2b'
        RETURNING id INTO v_supplier_supplier_id;
      END IF;

      IF v_supplier_supplier_id IS NOT NULL THEN
        INSERT INTO invoices (
          establishment_id, organization_id, supplier_id,
          supplier_name, invoice_number, invoice_date, amount_eur,
          file_path, file_name, file_size, file_type,
          created_by, b2b_order_id, b2b_status
        ) VALUES (
          v_order.destination_establishment_id, v_supplier_est.organization_id,
          v_supplier_supplier_id,
          (SELECT name FROM establishments WHERE id = p_client_establishment_id),
          v_invoice_number, v_invoice_date, ROUND(v_total_eur, 2),
          'b2b/auto', 'facture-b2b-auto', 0, 'b2b',
          p_client_user_id, p_order_id, 'issued'
        );
      ELSE
        v_invoice_warning := COALESCE(v_invoice_warning, '') || 'SUPPLIER_INVOICE_SKIPPED:NO_RELATIONSHIP;';
      END IF;

      IF v_client_supplier_id IS NOT NULL THEN
        INSERT INTO invoices (
          establishment_id, organization_id, supplier_id,
          supplier_name, invoice_number, invoice_date, amount_eur,
          file_path, file_name, file_size, file_type,
          created_by, b2b_order_id, b2b_status
        ) VALUES (
          p_client_establishment_id, p_client_organization_id,
          v_client_supplier_id,
          (SELECT name FROM establishments WHERE id = v_order.destination_establishment_id),
          v_invoice_number, v_invoice_date, ROUND(v_total_eur, 2),
          'b2b/auto', 'facture-b2b-auto', 0, 'b2b',
          p_client_user_id, p_order_id, 'received'
        );
      ELSE
        v_invoice_warning := COALESCE(v_invoice_warning, '') || 'CLIENT_INVOICE_SKIPPED:NO_RELATIONSHIP;';
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_invoice_warning := 'INVOICE_GENERATION_FAILED:' || SQLERRM;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'supplier_post', v_post_result,
    'receipt_document_id', v_receipt_doc_id,
    'bl_reception_id', v_bl_reception_id,
    'receipt_events_created', v_receipt_event_count,
    'lines_processed', v_line_count,
    'invoice_warning', v_invoice_warning
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$function$;
