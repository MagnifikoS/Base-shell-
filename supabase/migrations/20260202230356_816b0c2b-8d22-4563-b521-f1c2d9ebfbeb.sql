-- Compute supplier maturity score (0-100)
-- Based on: coverage (40%), code stability (25%), alias learning (20%), extraction health (15%)
-- Window: 60 days, max 20 invoices

CREATE OR REPLACE FUNCTION public.compute_supplier_maturity(
  p_supplier_id uuid,
  p_establishment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH inv AS (
    SELECT i.id, i.supplier_id, i.establishment_id, i.invoice_date, i.created_at
    FROM invoices i
    WHERE i.establishment_id = p_establishment_id
      AND i.supplier_id = p_supplier_id
      AND i.invoice_date >= (current_date - interval '60 days')
    ORDER BY i.invoice_date DESC, i.created_at DESC
    LIMIT 20
  ),
  
  lines AS (
    SELECT
      li.invoice_id,
      li.product_id,
      -- Get product_code from the linked product
      sep.product_code,
      sep.supplier_product_code
    FROM invoice_line_items li
    JOIN inv ON inv.id = li.invoice_id
    LEFT JOIN supplier_extracted_products sep ON sep.id = li.product_id
  ),
  
  agg_lines AS (
    SELECT
      count(*) AS total_lines,
      count(*) FILTER (WHERE product_id IS NOT NULL) AS matched_lines,
      count(*) FILTER (WHERE coalesce(product_code, supplier_product_code) IS NOT NULL) AS lines_with_code
    FROM lines
  ),
  
  -- Code stability: among codes used in the window, how many map to exactly 1 product_id
  code_map AS (
    SELECT
      coalesce(product_code, supplier_product_code) AS code,
      count(DISTINCT product_id) AS distinct_products_for_code
    FROM lines
    WHERE coalesce(product_code, supplier_product_code) IS NOT NULL
    GROUP BY coalesce(product_code, supplier_product_code)
  ),
  
  agg_codes AS (
    SELECT
      count(*) AS distinct_codes,
      count(*) FILTER (WHERE distinct_products_for_code = 1) AS stable_codes
    FROM code_map
  ),
  
  aliases AS (
    SELECT
      count(*) AS aliases_created
    FROM supplier_product_aliases spa
    WHERE spa.establishment_id = p_establishment_id
      AND spa.supplier_id = p_supplier_id
      AND spa.created_at >= (now() - interval '60 days')
  ),
  
  -- Count extractions with status != 'extracted' as needing review
  review_data AS (
    SELECT
      count(*) AS total_extractions,
      count(*) FILTER (WHERE ie.status IN ('pending', 'error', 'review_required')) AS extractions_needing_review
    FROM invoice_extractions ie
    JOIN inv ON inv.id = ie.invoice_id
  )
  
  SELECT jsonb_build_object(
    -- Raw components
    'total_lines', al.total_lines,
    'matched_lines', al.matched_lines,
    'lines_with_code', al.lines_with_code,
    'distinct_codes', ac.distinct_codes,
    'stable_codes', ac.stable_codes,
    'aliases_created', a.aliases_created,
    'invoices_in_window', (SELECT count(*) FROM inv),
    
    -- Sub-scores (0-1)
    'coverage', CASE WHEN al.total_lines > 0 THEN round((al.matched_lines::numeric / al.total_lines)::numeric, 3) ELSE 0 END,
    
    'code_share', CASE WHEN al.total_lines > 0 THEN round((al.lines_with_code::numeric / al.total_lines)::numeric, 3) ELSE 0 END,
    
    'code_stability', CASE WHEN ac.distinct_codes > 0 THEN round((ac.stable_codes::numeric / ac.distinct_codes)::numeric, 3) ELSE 0 END,
    
    'code_score', round((
      (CASE WHEN al.total_lines > 0 THEN al.lines_with_code::numeric / al.total_lines ELSE 0 END)
      *
      (CASE WHEN ac.distinct_codes > 0 THEN ac.stable_codes::numeric / ac.distinct_codes ELSE 0 END)
    )::numeric, 3),
    
    'alias_rate', CASE WHEN al.total_lines > 0 THEN round((a.aliases_created::numeric / al.total_lines)::numeric, 3) ELSE 0 END,
    
    'alias_score', round(least(
      (CASE WHEN al.total_lines > 0 THEN a.aliases_created::numeric / al.total_lines ELSE 0 END) / 0.08,
      1
    )::numeric, 3),
    
    'review_rate', CASE WHEN rd.total_extractions > 0 
      THEN round((rd.extractions_needing_review::numeric / rd.total_extractions)::numeric, 3) 
      ELSE 0 END,
    
    'health', round((
      1 - least(
        (CASE WHEN rd.total_extractions > 0 THEN rd.extractions_needing_review::numeric / rd.total_extractions ELSE 0 END) / 0.25,
        1
      )
    )::numeric, 3),
    
    -- Final maturity score 0-100
    'maturity_score', round(100 * (
      0.40 * (CASE WHEN al.total_lines > 0 THEN al.matched_lines::numeric / al.total_lines ELSE 0 END)
      + 0.25 * (
        (CASE WHEN al.total_lines > 0 THEN al.lines_with_code::numeric / al.total_lines ELSE 0 END)
        *
        (CASE WHEN ac.distinct_codes > 0 THEN ac.stable_codes::numeric / ac.distinct_codes ELSE 0 END)
      )
      + 0.20 * least(
        (CASE WHEN al.total_lines > 0 THEN a.aliases_created::numeric / al.total_lines ELSE 0 END) / 0.08,
        1
      )
      + 0.15 * (
        1 - least(
          (CASE WHEN rd.total_extractions > 0 THEN rd.extractions_needing_review::numeric / rd.total_extractions ELSE 0 END) / 0.25,
          1
        )
      )
    ))::int,
    
    -- Level classification
    'level', CASE
      WHEN round(100 * (
        0.40 * (CASE WHEN al.total_lines > 0 THEN al.matched_lines::numeric / al.total_lines ELSE 0 END)
        + 0.25 * (
          (CASE WHEN al.total_lines > 0 THEN al.lines_with_code::numeric / al.total_lines ELSE 0 END)
          *
          (CASE WHEN ac.distinct_codes > 0 THEN ac.stable_codes::numeric / ac.distinct_codes ELSE 0 END)
        )
        + 0.20 * least(
          (CASE WHEN al.total_lines > 0 THEN a.aliases_created::numeric / al.total_lines ELSE 0 END) / 0.08,
          1
        )
        + 0.15 * (
          1 - least(
            (CASE WHEN rd.total_extractions > 0 THEN rd.extractions_needing_review::numeric / rd.total_extractions ELSE 0 END) / 0.25,
            1
          )
        )
      )) >= 85 THEN 'mastered'
      WHEN round(100 * (
        0.40 * (CASE WHEN al.total_lines > 0 THEN al.matched_lines::numeric / al.total_lines ELSE 0 END)
        + 0.25 * (
          (CASE WHEN al.total_lines > 0 THEN al.lines_with_code::numeric / al.total_lines ELSE 0 END)
          *
          (CASE WHEN ac.distinct_codes > 0 THEN ac.stable_codes::numeric / ac.distinct_codes ELSE 0 END)
        )
        + 0.20 * least(
          (CASE WHEN al.total_lines > 0 THEN a.aliases_created::numeric / al.total_lines ELSE 0 END) / 0.08,
          1
        )
        + 0.15 * (
          1 - least(
            (CASE WHEN rd.total_extractions > 0 THEN rd.extractions_needing_review::numeric / rd.total_extractions ELSE 0 END) / 0.25,
            1
          )
        )
      )) >= 70 THEN 'mature'
      WHEN round(100 * (
        0.40 * (CASE WHEN al.total_lines > 0 THEN al.matched_lines::numeric / al.total_lines ELSE 0 END)
        + 0.25 * (
          (CASE WHEN al.total_lines > 0 THEN al.lines_with_code::numeric / al.total_lines ELSE 0 END)
          *
          (CASE WHEN ac.distinct_codes > 0 THEN ac.stable_codes::numeric / ac.distinct_codes ELSE 0 END)
        )
        + 0.20 * least(
          (CASE WHEN al.total_lines > 0 THEN a.aliases_created::numeric / al.total_lines ELSE 0 END) / 0.08,
          1
        )
        + 0.15 * (
          1 - least(
            (CASE WHEN rd.total_extractions > 0 THEN rd.extractions_needing_review::numeric / rd.total_extractions ELSE 0 END) / 0.25,
            1
          )
        )
      )) >= 40 THEN 'stabilizing'
      ELSE 'new'
    END
  ) INTO v_result
  FROM agg_lines al
  CROSS JOIN agg_codes ac
  CROSS JOIN aliases a
  CROSS JOIN review_data rd;
  
  RETURN COALESCE(v_result, jsonb_build_object(
    'total_lines', 0,
    'matched_lines', 0,
    'maturity_score', 0,
    'level', 'new',
    'coverage', 0,
    'code_score', 0,
    'alias_score', 0,
    'health', 1,
    'invoices_in_window', 0
  ));
END;
$$;