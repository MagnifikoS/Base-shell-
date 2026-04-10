DO $$
DECLARE
  v_group RECORD;
  v_neg RECORD;
  v_doc_id uuid;
  v_result jsonb;
BEGIN
  FOR v_group IN
    SELECT se.establishment_id, e.organization_id, se.storage_zone_id
    FROM stock_events se
    JOIN establishments e ON e.id = se.establishment_id
    WHERE se.event_type != 'VOID'
    GROUP BY se.establishment_id, e.organization_id, se.storage_zone_id
    HAVING MIN(
      (SELECT SUM(se2.delta_quantity_canonical) FROM stock_events se2
       WHERE se2.establishment_id = se.establishment_id
         AND se2.storage_zone_id = se.storage_zone_id
         AND se2.event_type != 'VOID'
         AND se2.product_id = se2.product_id
       GROUP BY se2.product_id
       ORDER BY SUM(se2.delta_quantity_canonical) ASC LIMIT 1)
    ) < 0
  LOOP
    v_doc_id := gen_random_uuid();
    
    INSERT INTO stock_documents (
      id, establishment_id, organization_id, storage_zone_id,
      type, status, lock_version, created_by, idempotency_key
    ) VALUES (
      v_doc_id, v_group.establishment_id, v_group.organization_id,
      v_group.storage_zone_id, 'ADJUSTMENT', 'DRAFT', 0, NULL,
      'cleanup_neg_v1:' || v_group.establishment_id || ':' || v_group.storage_zone_id
    );

    FOR v_neg IN
      SELECT 
        sub.product_id,
        sub.canonical_unit_id,
        sub.canonical_family,
        sub.canonical_label,
        sub.context_hash,
        ABS(sub.total) as adjustment_qty
      FROM (
        SELECT DISTINCT ON (se.product_id)
          se.product_id,
          se.canonical_unit_id,
          se.canonical_family,
          se.canonical_label,
          se.context_hash,
          SUM(se.delta_quantity_canonical) OVER (PARTITION BY se.product_id) as total
        FROM stock_events se
        WHERE se.establishment_id = v_group.establishment_id
          AND se.storage_zone_id = v_group.storage_zone_id
          AND se.event_type != 'VOID'
        ORDER BY se.product_id, se.created_at DESC
      ) sub
      WHERE sub.total < 0
    LOOP
      INSERT INTO stock_document_lines (
        document_id, product_id,
        delta_quantity_canonical, canonical_unit_id,
        canonical_family, canonical_label, context_hash
      ) VALUES (
        v_doc_id, v_neg.product_id, v_neg.adjustment_qty,
        v_neg.canonical_unit_id, v_neg.canonical_family,
        v_neg.canonical_label, v_neg.context_hash
      );
    END LOOP;

    v_result := fn_post_stock_document(
      p_document_id := v_doc_id,
      p_expected_lock_version := 0,
      p_posted_by := NULL,
      p_idempotency_key := 'cleanup_neg_v1:' || v_group.establishment_id || ':' || v_group.storage_zone_id,
      p_event_reason := 'CLEANUP_NEGATIVE_STOCK_V1'
    );

    IF NOT (v_result->>'ok')::boolean THEN
      RAISE EXCEPTION 'Cleanup FAILED for zone %: %', v_group.storage_zone_id, v_result;
    END IF;
  END LOOP;
END;
$$