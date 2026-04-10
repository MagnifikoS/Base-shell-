
-- ═══════════════════════════════════════════════════════════════════════════
-- fn_create_order: Atomic order creation (header + lines in one transaction)
-- Replaces the 2-step frontend pattern in useCreateProductOrder
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_create_order(
  p_organization_id UUID,
  p_source_establishment_id UUID,
  p_destination_establishment_id UUID,
  p_note TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_src_name TEXT;
  v_dst_name TEXT;
  v_line JSONB;
  v_line_count INT := 0;
BEGIN
  -- ── Preconditions ──
  IF p_created_by IS NULL THEN
    RAISE EXCEPTION 'p_created_by is required';
  END IF;
  
  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Le panier est vide';
  END IF;

  -- ── Resolve establishment names for snapshot ──
  SELECT name INTO v_src_name FROM establishments WHERE id = p_source_establishment_id;
  SELECT name INTO v_dst_name FROM establishments WHERE id = p_destination_establishment_id;

  -- ── Create order header ──
  INSERT INTO product_orders (
    organization_id,
    source_establishment_id,
    destination_establishment_id,
    source_name_snapshot,
    destination_name_snapshot,
    status,
    note,
    created_by
  ) VALUES (
    p_organization_id,
    p_source_establishment_id,
    p_destination_establishment_id,
    v_src_name,
    v_dst_name,
    'sent',
    p_note,
    p_created_by
  )
  RETURNING id INTO v_order_id;

  -- ── Insert lines ──
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO product_order_lines (
      order_id,
      product_id,
      product_name_snapshot,
      quantity_requested,
      canonical_unit_id,
      unit_label,
      prep_status
    ) VALUES (
      v_order_id,
      (v_line->>'product_id')::UUID,
      v_line->>'product_name',
      (v_line->>'quantity')::NUMERIC,
      (v_line->>'canonical_unit_id')::UUID,
      v_line->>'unit_label',
      'pending'
    );
    v_line_count := v_line_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'line_count', v_line_count
  );
END;
$$;

-- Grant to authenticated users only
REVOKE EXECUTE ON FUNCTION public.fn_create_order(UUID, UUID, UUID, TEXT, UUID, JSONB) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_create_order(UUID, UUID, UUID, TEXT, UUID, JSONB) TO authenticated;
