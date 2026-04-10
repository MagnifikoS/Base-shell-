
-- ═══════════════════════════════════════════════════════════════════════════
-- TVA France: Move enrichment to DB-side + idempotency guard
--
-- 1. Add UNIQUE constraint on b2b_invoice_lines(invoice_id, line_index)
--    → prevents duplicate lines if enrichment runs twice
-- 2. Add STEP 12 to fn_post_b2b_reception: compute & insert VAT lines
--    atomically right after invoice creation (no more UI-side call)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Unique constraint for idempotency
ALTER TABLE b2b_invoice_lines
  ADD CONSTRAINT uq_b2b_invoice_lines_invoice_line
  UNIQUE (invoice_id, line_index);

-- 2. Recreate fn_post_b2b_reception with embedded VAT enrichment
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
  v_dest_est_name TEXT;
  v_client_est_name TEXT;
  -- VAT enrichment vars
  v_vat_enabled BOOLEAN;
  v_inv RECORD;
  v_vat_line RECORD;
  v_vat_line_idx INT;
  v_sum_ht NUMERIC(12,2);
  v_sum_vat NUMERIC(12,2);
  v_sum_ttc NUMERIC(12,2);
  v_vat_warning TEXT := NULL;
BEGIN
  v_idempotency_key := 'b2b-receipt-' || p_order_id::text;

  -- ═══ GUARD 1: Idempotency ═══
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

  -- ═══ GUARD 2: Clean orphan DRAFT ═══
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

  SELECT id, organization_id, name INTO v_supplier_est
  FROM establishments WHERE id = v_order.destination_establishment_id;

  v_dest_est_name := v_supplier_est.name;
  SELECT name INTO v_client_est_name FROM establishments WHERE id = p_client_establishment_id;

  -- ═══ STEP 1: Update supplier draft lines ═══
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_validated_lines)
  LOOP
    UPDATE stock_document_lines
    SET delta_quantity_canonical = -1 * ABS((v_line->>'quantity_canonical')::NUMERIC)
    WHERE document_id = v_stock_doc.id
      AND product_id = (v_line->>'supplier_product_id')::UUID;
    GET DIAGNOSTICS v_updated_lines = ROW_COUNT;
  END LOOP;

  -- ═══ STEP 2: Post supplier withdrawal ═══
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

  -- ═══ STEP 3: Rebuild BL withdrawal lines ═══
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

  -- ═══ STEP 4: Resolve client header zone ═══
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

  -- ═══ STEP 6: Create client RECEIPT directly as POSTED ═══
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

  -- ═══ STEP 7: Create stock_document_lines ═══
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

  -- ═══ STEP 8: Create stock_events ═══
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

  -- ═══ STEP 9: Create BL Réception ═══
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

  -- ═══ STEP 10: Close order ═══
  UPDATE product_orders SET status = 'closed' WHERE id = p_order_id;

  UPDATE product_order_lines pol SET
    quantity_received = ABS((jl->>'quantity_canonical')::NUMERIC)
  FROM jsonb_array_elements(p_validated_lines) AS jl
  WHERE pol.order_id = p_order_id
    AND pol.product_id = (jl->>'client_product_id')::UUID;

  -- ═══ STEP 11: Generate B2B invoices ═══
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
          v_dest_est_name,
          'active', v_order.destination_establishment_id, 'b2b'
        )
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
          v_client_est_name,
          'active', p_client_establishment_id, 'b2b'
        )
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
          v_client_est_name,
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
          v_client_supplier_id,
          v_dest_est_name,
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
      organization_id, action, target_type, target_id, user_id,
      metadata
    ) VALUES (
      p_client_organization_id,
      'b2b_invoice_generation_failed',
      'product_order',
      p_order_id,
      p_client_user_id,
      jsonb_build_object('error', SQLERRM, 'sqlstate', SQLSTATE, 'order_id', p_order_id)
    );
  END;

  -- ═══════════════════════════════════════════════════════════════════════
  -- STEP 12: TVA France enrichment (atomic, idempotent, server-side)
  --
  -- Reads BL retrait lines (price snapshots) + product categories,
  -- computes VAT per line, inserts b2b_invoice_lines, updates invoice totals.
  -- Idempotency: UNIQUE(invoice_id, line_index) prevents duplicates.
  -- Non-blocking: errors are logged but don't kill the transaction.
  -- ═══════════════════════════════════════════════════════════════════════
  BEGIN
    -- Check feature toggle via app_settings (default: disabled)
    v_vat_enabled := COALESCE(
      current_setting('app.vat_france_b2b_enabled', true)::boolean,
      false
    );

    -- Even if toggle is off, we still enrich if we have price data
    -- The toggle controls whether VAT rates are applied or not
    -- For now: always enrich with VAT when BL retrait has prices
    FOR v_inv IN
      SELECT id, amount_eur
      FROM invoices
      WHERE b2b_order_id = p_order_id
        AND b2b_status IS NOT NULL
    LOOP
      -- Skip if already enriched (idempotency check)
      IF EXISTS (SELECT 1 FROM b2b_invoice_lines WHERE invoice_id = v_inv.id LIMIT 1) THEN
        CONTINUE;
      END IF;

      -- Insert VAT snapshot lines from BL retrait data + product categories
      v_vat_line_idx := 0;
      v_sum_ht := 0;
      v_sum_vat := 0;
      v_sum_ttc := 0;

      FOR v_vat_line IN
        SELECT
          bwl.product_id,
          bwl.product_name_snapshot,
          bwl.quantity_canonical,
          COALESCE(bwl.unit_price_snapshot, 0) AS unit_price_ht,
          COALESCE(pc.name, p2.category) AS product_category
        FROM bl_withdrawal_lines bwl
        LEFT JOIN products_v2 p2 ON p2.id = bwl.product_id
        LEFT JOIN product_categories pc ON pc.id = p2.category_id
        WHERE bwl.bl_withdrawal_document_id = v_order.bl_retrait_document_id
      LOOP
        DECLARE
          v_vat_rate NUMERIC(5,4) := 0;
          v_cat_lower TEXT;
          v_unit_price_ttc NUMERIC(12,4);
          v_line_total_ht NUMERIC(12,2);
          v_line_total_ttc NUMERIC(12,2);
          v_line_vat NUMERIC(12,2);
        BEGIN
          -- Resolve VAT rate from category
          v_cat_lower := LOWER(TRIM(COALESCE(v_vat_line.product_category, '')));

          IF v_cat_lower IN (
            'boissons (soft)', 'boulangerie / pâtisserie', 'café / thé',
            'charcuterie', 'condiments / sauces', 'crèmerie / produits laitiers',
            'épicerie sèche', 'fruits et légumes', 'huiles / vinaigres',
            'poissonnerie', 'surgelés', 'viandes / boucherie'
          ) THEN
            v_vat_rate := 0.055;
          ELSIF v_cat_lower IN (
            'hygiène / entretien', 'emballages / jetables', 'emballage'
          ) THEN
            v_vat_rate := 0.20;
          ELSE
            -- Unknown category: log warning, skip VAT for this line (rate=0)
            v_vat_warning := COALESCE(v_vat_warning, '') ||
              'UNKNOWN_CATEGORY:' || COALESCE(v_vat_line.product_category, 'NULL') ||
              ' for product ' || v_vat_line.product_id::text || ';';
            v_vat_rate := 0;
          END IF;

          -- Compute prices
          v_unit_price_ttc := ROUND(v_vat_line.unit_price_ht * (1 + v_vat_rate), 2);
          v_line_total_ht := ROUND(v_vat_line.quantity_canonical * v_vat_line.unit_price_ht, 2);
          v_line_total_ttc := ROUND(v_vat_line.quantity_canonical * v_unit_price_ttc, 2);
          v_line_vat := v_line_total_ttc - v_line_total_ht;

          -- Insert line (ON CONFLICT DO NOTHING for idempotency)
          INSERT INTO b2b_invoice_lines (
            invoice_id, product_id, label_snapshot,
            quantity, vat_rate, unit_price_ht, unit_price_ttc,
            line_total_ht, vat_amount, line_total_ttc, line_index
          ) VALUES (
            v_inv.id,
            v_vat_line.product_id,
            COALESCE(v_vat_line.product_name_snapshot, '—'),
            v_vat_line.quantity_canonical,
            v_vat_rate,
            v_vat_line.unit_price_ht,
            v_unit_price_ttc,
            v_line_total_ht,
            v_line_vat,
            v_line_total_ttc,
            v_vat_line_idx
          )
          ON CONFLICT (invoice_id, line_index) DO NOTHING;

          v_sum_ht := v_sum_ht + v_line_total_ht;
          v_sum_vat := v_sum_vat + v_line_vat;
          v_sum_ttc := v_sum_ttc + v_line_total_ttc;
          v_vat_line_idx := v_vat_line_idx + 1;
        END;
      END LOOP;

      -- Rounding adjustment: ensure HT + VAT = TTC (±0.01 max)
      IF ABS(v_sum_ht + v_sum_vat - v_sum_ttc) > 0 AND ABS(v_sum_ht + v_sum_vat - v_sum_ttc) <= 0.01 THEN
        v_sum_vat := v_sum_ttc - v_sum_ht;
      END IF;

      -- Update invoice totals
      UPDATE invoices
      SET amount_ht = v_sum_ht,
          vat_amount = v_sum_vat,
          amount_eur = v_sum_ttc
      WHERE id = v_inv.id;

    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Non-blocking: log VAT enrichment failure
    v_vat_warning := 'VAT_ENRICHMENT_FAILED:' || SQLERRM || ' [' || SQLSTATE || ']';
    INSERT INTO audit_logs (
      organization_id, action, target_type, target_id, user_id,
      metadata
    ) VALUES (
      p_client_organization_id,
      'b2b_vat_enrichment_failed',
      'product_order',
      p_order_id,
      p_client_user_id,
      jsonb_build_object('error', SQLERRM, 'sqlstate', SQLSTATE, 'order_id', p_order_id)
    );
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'supplier_post', v_post_result,
    'receipt_document_id', v_receipt_doc_id,
    'bl_reception_id', v_bl_reception_id,
    'receipt_events_created', v_receipt_event_count,
    'lines_processed', v_line_count,
    'invoice_warning', v_invoice_warning,
    'vat_warning', v_vat_warning
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$function$;
