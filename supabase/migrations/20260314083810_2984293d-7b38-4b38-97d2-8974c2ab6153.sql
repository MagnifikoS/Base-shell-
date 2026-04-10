
-- ═══════════════════════════════════════════════════════════════════════════
-- CORRECTION CAS 1 / C1: Fermeture du fallback silencieux 'count'
-- dans fn_post_b2b_reception
--
-- AVANT: COALESCE(v_line->>'client_canonical_family', 'count')
--   → écrivait silencieusement 'count' si le champ manquait
--
-- APRÈS: Validation stricte — RAISE EXCEPTION si absent
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
  v_dest_est_name TEXT;
  v_client_est_name TEXT;
  v_vat_result JSONB;
  v_supplier_already_posted BOOLEAN := false;
  v_line_canonical_family TEXT;
BEGIN
  -- ═══ STEP 0: Validate order ═══
  SELECT po.*, po.supplier_establishment_id AS supplier_est_id
  INTO v_order
  FROM product_orders po
  WHERE po.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  IF v_order.status NOT IN ('shipped', 'awaiting_client_validation') THEN
    RAISE EXCEPTION 'Order % has invalid status: %', p_order_id, v_order.status;
  END IF;

  -- ═══ Idempotency check ═══
  v_idempotency_key := 'b2b_reception_' || p_order_id::TEXT;
  SELECT sd.id INTO v_existing_receipt_id
  FROM stock_documents sd
  WHERE sd.idempotency_key = v_idempotency_key
    AND sd.establishment_id = p_client_establishment_id
    AND sd.type = 'RECEIPT'
  LIMIT 1;

  IF v_existing_receipt_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'receipt_document_id', v_existing_receipt_id,
      'idempotent', true,
      'message', 'Reception already processed (idempotent)'
    );
  END IF;

  -- ═══ STEP 0b: Resolve client header zone ═══
  SELECT ess.default_receipt_zone_id INTO v_client_header_zone_id
  FROM establishment_stock_settings ess
  WHERE ess.establishment_id = p_client_establishment_id;

  IF v_client_header_zone_id IS NULL THEN
    SELECT sz.id INTO v_client_header_zone_id
    FROM storage_zones sz
    WHERE sz.establishment_id = p_client_establishment_id
    ORDER BY sz.created_at ASC
    LIMIT 1;
  END IF;

  IF v_client_header_zone_id IS NULL THEN
    RAISE EXCEPTION 'No storage zone found for client establishment %', p_client_establishment_id;
  END IF;

  -- ═══ STEP 0c: Validate missing zones / snapshots ═══
  SELECT jsonb_agg(sub.product_id) INTO v_missing_zone_products
  FROM (
    SELECT DISTINCT (vl->>'client_product_id')::UUID AS product_id
    FROM jsonb_array_elements(p_validated_lines) vl
    WHERE NOT EXISTS (
      SELECT 1 FROM products_v2 p2
      WHERE p2.id = (vl->>'client_product_id')::UUID
        AND p2.storage_zone_id IS NOT NULL
    )
  ) sub;

  SELECT jsonb_agg(DISTINCT sub.zone_id) INTO v_missing_snapshot_zones
  FROM (
    SELECT p2.storage_zone_id AS zone_id
    FROM jsonb_array_elements(p_validated_lines) vl
    JOIN products_v2 p2 ON p2.id = (vl->>'client_product_id')::UUID
    WHERE p2.storage_zone_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM zone_stock_snapshots zss
        WHERE zss.establishment_id = p_client_establishment_id
          AND zss.storage_zone_id = p2.storage_zone_id
      )
  ) sub;

  -- ═══ STEP 1: POST supplier stock document ═══
  SELECT * INTO v_bl_retrait
  FROM bl_withdrawal_documents bwd
  WHERE bwd.id = v_order.bl_retrait_document_id;

  IF v_bl_retrait.stock_document_id IS NOT NULL THEN
    SELECT * INTO v_stock_doc
    FROM stock_documents sd
    WHERE sd.id = v_bl_retrait.stock_document_id;

    IF v_stock_doc.status = 'DRAFT' THEN
      v_supplier_already_posted := false;
      INSERT INTO audit_logs (organization_id, user_id, action, target_type, target_id, metadata)
      VALUES (
        p_client_organization_id, p_client_user_id,
        'b2b_reception_skip_supplier_post',
        'product_order', p_order_id,
        jsonb_build_object(
          'reason', 'supplier stock_document still DRAFT',
          'stock_document_id', v_bl_retrait.stock_document_id,
          'supplier_establishment_id', v_order.supplier_est_id
        )
      );
    ELSIF v_stock_doc.status = 'POSTED' THEN
      v_supplier_already_posted := true;
    ELSE
      v_post_result := fn_post_stock_document(v_bl_retrait.stock_document_id, p_client_user_id);
      v_supplier_already_posted := true;
    END IF;
  END IF;

  -- ═══ STEP 2: Create BL withdrawal lines (supplier side) ═══
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_validated_lines)
  LOOP
    INSERT INTO bl_withdrawal_lines (
      bl_withdrawal_document_id, product_id, product_name_snapshot,
      quantity_canonical, canonical_unit_id,
      unit_price_snapshot, line_total_snapshot
    ) VALUES (
      v_bl_retrait.id,
      (v_line->>'supplier_product_id')::UUID,
      COALESCE(v_line->>'product_name_snapshot', ''),
      ABS((v_line->>'quantity_canonical')::NUMERIC),
      (v_line->>'supplier_canonical_unit_id')::UUID,
      CASE WHEN v_line->>'unit_price' IS NOT NULL THEN (v_line->>'unit_price')::NUMERIC ELSE NULL END,
      CASE WHEN v_line->>'line_total' IS NOT NULL THEN (v_line->>'line_total')::NUMERIC ELSE NULL END
    );
    v_total_eur := v_total_eur + COALESCE((v_line->>'line_total')::NUMERIC, 0);
    v_line_count := v_line_count + 1;
  END LOOP;
  UPDATE bl_withdrawal_documents SET total_eur = ROUND(v_total_eur, 2) WHERE id = v_bl_retrait.id;

  -- ═══ STEP 3: Create client RECEIPT (POSTED directly) ═══
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
    -- ═══ CORRECTION CAS 1 / C1: Validation stricte de canonical_family ═══
    v_line_canonical_family := v_line->>'client_canonical_family';
    IF v_line_canonical_family IS NULL OR v_line_canonical_family = '' THEN
      RAISE EXCEPTION 'B2B_RECEPTION_MISSING_FAMILY: Le champ client_canonical_family est obligatoire pour le produit % (ligne: %). Impossible d''écrire un mouvement stock sans famille canonique.',
        v_line->>'client_product_id', v_line::TEXT;
    END IF;

    INSERT INTO stock_document_lines (
      document_id, product_id, delta_quantity_canonical,
      canonical_unit_id, canonical_family, context_hash
    ) VALUES (
      v_receipt_doc_id,
      (v_line->>'client_product_id')::UUID,
      ABS((v_line->>'quantity_canonical')::NUMERIC),
      (v_line->>'client_canonical_unit_id')::UUID,
      v_line_canonical_family,
      v_line->>'client_context_hash'
    );
  END LOOP;

  -- ═══ STEP 4: Create stock events for client receipt ═══
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
  LEFT JOIN zone_stock_snapshots zss
    ON zss.establishment_id = p_client_establishment_id
    AND zss.storage_zone_id = p.storage_zone_id
  WHERE dl.document_id = v_receipt_doc_id
    AND p.storage_zone_id IS NOT NULL
    AND zss.id IS NOT NULL;

  GET DIAGNOSTICS v_receipt_event_count = ROW_COUNT;

  -- ═══ STEP 5: Negative stock check for client ═══
  FOR v_sc_record IN
    SELECT
      se.product_id,
      se.storage_zone_id,
      se.snapshot_version_id AS snap_ver,
      il.quantity AS snap_qty,
      SUM(se2.delta_quantity_canonical) AS total_delta
    FROM stock_events se
    JOIN zone_stock_snapshots zss2
      ON zss2.establishment_id = p_client_establishment_id
      AND zss2.storage_zone_id = se.storage_zone_id
    LEFT JOIN inventory_lines il
      ON il.session_id = se.snapshot_version_id
      AND il.product_id = se.product_id
    LEFT JOIN stock_events se2
      ON se2.product_id = se.product_id
      AND se2.storage_zone_id = se.storage_zone_id
      AND se2.snapshot_version_id = se.snapshot_version_id
    WHERE se.document_id = v_receipt_doc_id
    GROUP BY se.product_id, se.storage_zone_id, se.snapshot_version_id, il.quantity
    HAVING (COALESCE(il.quantity, 0) + SUM(se2.delta_quantity_canonical)) < 0
  LOOP
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
      v_sc_record.storage_zone_id,
      v_sc_record.product_id,
      v_receipt_doc_id,
      'ADJUSTMENT'::stock_event_type,
      'AUTO_NEGATIVE_CORRECTION',
      ABS(COALESCE(v_sc_record.snap_qty, 0) + v_sc_record.total_delta),
      se_ref.canonical_unit_id,
      se_ref.canonical_family,
      se_ref.canonical_label,
      se_ref.context_hash,
      v_sc_record.snap_ver,
      true,
      'Correction automatique stock négatif après réception B2B',
      p_client_user_id
    FROM stock_events se_ref
    WHERE se_ref.document_id = v_receipt_doc_id
      AND se_ref.product_id = v_sc_record.product_id
    LIMIT 1;
  END LOOP;

  -- ═══ STEP 6: Update commande_lines received_quantity ═══
  UPDATE commande_lines cl
  SET received_quantity = sub.total_received
  FROM (
    SELECT
      (vl->>'commande_line_id')::UUID AS cl_id,
      (vl->>'quantity_canonical')::NUMERIC AS total_received
    FROM jsonb_array_elements(p_validated_lines) vl
    WHERE vl->>'commande_line_id' IS NOT NULL
  ) sub
  WHERE cl.id = sub.cl_id;
  GET DIAGNOSTICS v_updated_lines = ROW_COUNT;

  -- ═══ STEP 7: Update order status ═══
  UPDATE product_orders
  SET
    status = 'received',
    received_at = now(),
    received_by = p_client_user_id
  WHERE id = p_order_id;

  -- ═══ STEP 8: Create BL reception ═══
  SELECT e.name INTO v_dest_est_name
  FROM establishments e
  WHERE e.id = v_order.supplier_est_id;

  SELECT e.name INTO v_client_est_name
  FROM establishments e
  WHERE e.id = p_client_establishment_id;

  INSERT INTO bl_app_documents (
    establishment_id, stock_document_id, bl_date, bl_number,
    supplier_name_snapshot, status, completed_at, created_by
  ) VALUES (
    p_client_establishment_id,
    v_receipt_doc_id,
    CURRENT_DATE,
    'BL-B2B-' || LEFT(p_order_id::TEXT, 8),
    COALESCE(v_dest_est_name, 'Fournisseur B2B'),
    'completed',
    now(),
    p_client_user_id
  ) RETURNING id INTO v_bl_reception_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_validated_lines)
  LOOP
    INSERT INTO bl_app_lines (
      bl_app_document_id, establishment_id, product_id,
      product_name_snapshot, quantity_canonical,
      canonical_unit_id, unit_price, line_total, context_hash
    ) VALUES (
      v_bl_reception_id,
      p_client_establishment_id,
      (v_line->>'client_product_id')::UUID,
      COALESCE(v_line->>'product_name_snapshot', ''),
      ABS((v_line->>'quantity_canonical')::NUMERIC),
      (v_line->>'client_canonical_unit_id')::UUID,
      CASE WHEN v_line->>'unit_price' IS NOT NULL THEN (v_line->>'unit_price')::NUMERIC ELSE NULL END,
      CASE WHEN v_line->>'line_total' IS NOT NULL THEN (v_line->>'line_total')::NUMERIC ELSE NULL END,
      v_line->>'client_context_hash'
    );
  END LOOP;

  -- ═══ STEP 9: Update commande status ═══
  UPDATE commandes c
  SET
    status = 'recue',
    received_at = now(),
    received_by = p_client_user_id,
    reception_type = 'b2b_inter_establishment'
  WHERE c.id = v_order.commande_id
    AND c.status NOT IN ('recue', 'cloturee');

  -- ═══ STEP 10: Create audit log ═══
  INSERT INTO audit_logs (organization_id, user_id, action, target_type, target_id, metadata)
  VALUES (
    p_client_organization_id,
    p_client_user_id,
    'b2b_reception_completed',
    'product_order',
    p_order_id,
    jsonb_build_object(
      'receipt_document_id', v_receipt_doc_id,
      'bl_reception_id', v_bl_reception_id,
      'receipt_event_count', v_receipt_event_count,
      'line_count', v_line_count,
      'total_eur', v_total_eur,
      'supplier_establishment_id', v_order.supplier_est_id,
      'client_establishment_id', p_client_establishment_id,
      'missing_zone_products', v_missing_zone_products,
      'missing_snapshot_zones', v_missing_snapshot_zones,
      'supplier_already_posted', v_supplier_already_posted
    )
  );

  -- ═══ STEP 11: Auto-generate invoice ═══
  BEGIN
    SELECT
      COALESCE(is2.id, is3.id) INTO v_client_supplier_id
    FROM establishments e
    LEFT JOIN invoice_suppliers is2
      ON is2.establishment_id = p_client_establishment_id
      AND is2.name = e.name
    LEFT JOIN invoice_suppliers is3
      ON is3.establishment_id = p_client_establishment_id
      AND is3.name = e.trade_name
    WHERE e.id = v_order.supplier_est_id
    LIMIT 1;

    IF v_client_supplier_id IS NULL THEN
      INSERT INTO invoice_suppliers (establishment_id, name, created_by)
      SELECT p_client_establishment_id, COALESCE(e.trade_name, e.name), p_client_user_id
      FROM establishments e WHERE e.id = v_order.supplier_est_id
      RETURNING id INTO v_client_supplier_id;
    END IF;

    UPDATE bl_app_documents
    SET supplier_id = v_client_supplier_id
    WHERE id = v_bl_reception_id;

    v_invoice_number := 'B2B-' || to_char(now(), 'YYYYMMDD') || '-' || LEFT(p_order_id::TEXT, 8);
    v_invoice_date := CURRENT_DATE;

    v_invoice_warning := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_invoice_warning := 'Invoice auto-generation failed: ' || SQLERRM;
  END;

  -- ═══ STEP 12: VAT enrichment ═══
  BEGIN
    v_vat_result := fn_enrich_b2b_reception_vat(v_bl_reception_id, p_client_establishment_id);
  EXCEPTION WHEN OTHERS THEN
    v_vat_result := jsonb_build_object('skipped', true, 'reason', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_document_id', v_receipt_doc_id,
    'bl_reception_id', v_bl_reception_id,
    'receipt_event_count', v_receipt_event_count,
    'line_count', v_line_count,
    'total_eur', v_total_eur,
    'commande_lines_updated', v_updated_lines,
    'missing_zone_products', v_missing_zone_products,
    'missing_snapshot_zones', v_missing_snapshot_zones,
    'invoice_warning', v_invoice_warning,
    'vat_enrichment', v_vat_result
  );
END;
$function$;
