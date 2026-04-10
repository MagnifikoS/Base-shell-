DO $$
DECLARE
  v_doc_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  INSERT INTO stock_documents (
    id, establishment_id, organization_id, storage_zone_id,
    type, status, lock_version, created_by, idempotency_key
  ) VALUES (
    v_doc_id, '7775d89d-9977-4b1b-bf0c-1b2efe486000',
    (SELECT organization_id FROM establishments WHERE id = '7775d89d-9977-4b1b-bf0c-1b2efe486000'),
    'e499a467-13ba-4f14-a3f1-503432097f01',
    'ADJUSTMENT', 'DRAFT', 0, NULL,
    'cleanup_neg_v1_fix:gant_latex_xl'
  );

  INSERT INTO stock_document_lines (
    document_id, product_id, delta_quantity_canonical,
    canonical_unit_id, canonical_family, canonical_label, context_hash
  ) VALUES (
    v_doc_id, '2ee3d6ca-a729-4001-8ba1-ea701bccf091', 400,
    '252649a4-3905-4e56-959e-f4735521fbf4', 'count', 'pce', '71e8e88f'
  );

  v_result := fn_post_stock_document(
    p_document_id := v_doc_id,
    p_expected_lock_version := 0,
    p_posted_by := NULL,
    p_idempotency_key := 'cleanup_neg_v1_fix:gant_latex_xl',
    p_event_reason := 'CLEANUP_NEGATIVE_STOCK_V1'
  );

  IF NOT (v_result->>'ok')::boolean THEN
    RAISE EXCEPTION 'Failed: %', v_result;
  END IF;
END;
$$