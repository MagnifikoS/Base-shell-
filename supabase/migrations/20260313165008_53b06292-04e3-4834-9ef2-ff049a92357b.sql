
-- Drop the OLD overload (2 params only) to resolve ambiguity
DROP FUNCTION IF EXISTS public.fn_initialize_product_stock(uuid, uuid);

-- Recreate the single canonical version with optional initial quantity
CREATE OR REPLACE FUNCTION public.fn_initialize_product_stock(
  p_product_id uuid,
  p_user_id uuid,
  p_initial_quantity numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_establishment_id uuid;
  v_latest_session_id uuid;
  v_existing_line_id uuid;
  v_snapshot_version_id uuid;
  v_unit_id uuid;
BEGIN
  -- 1. Get product establishment and unit
  SELECT establishment_id, stock_handling_unit_id
    INTO v_establishment_id, v_unit_id
    FROM products_v2
   WHERE id = p_product_id;

  IF v_establishment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Produit introuvable');
  END IF;

  -- 2. Find latest completed inventory session
  SELECT id INTO v_latest_session_id
    FROM inventory_sessions
   WHERE establishment_id = v_establishment_id
     AND status = 'completed'
   ORDER BY completed_at DESC
   LIMIT 1;

  IF v_latest_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Aucun inventaire complété');
  END IF;

  -- 3. Check idempotency
  SELECT id INTO v_existing_line_id
    FROM inventory_lines
   WHERE session_id = v_latest_session_id
     AND product_id = p_product_id
   LIMIT 1;

  IF v_existing_line_id IS NOT NULL THEN
    -- Update quantity if different and initial_quantity > 0
    IF p_initial_quantity > 0 THEN
      UPDATE inventory_lines
         SET quantity = p_initial_quantity,
             unit_id = v_unit_id,
             counted_at = now(),
             counted_by = p_user_id,
             updated_at = now()
       WHERE id = v_existing_line_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'message', 'Ligne existante');
  END IF;

  -- 4. Get snapshot_version_id from session
  SELECT snapshot_version_id INTO v_snapshot_version_id
    FROM inventory_sessions
   WHERE id = v_latest_session_id;

  -- 5. Insert inventory line
  INSERT INTO inventory_lines (session_id, product_id, quantity, unit_id, counted_by, counted_at, created_via)
  VALUES (v_latest_session_id, p_product_id, p_initial_quantity, v_unit_id, p_user_id, now(), 'PRODUCT_INIT');

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'message', 'Produit initialisé',
    'snapshot_version_id', v_snapshot_version_id
  );
END;
$$;
