
-- ═══════════════════════════════════════════════════════════════════════════
-- fn_cancel_b2b_shipment — Annule une expédition B2B proprement
-- Utilise fn_void_stock_document pour inverser les mouvements de stock
-- Remet les lignes et la commande à l'état pré-expédition
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_cancel_b2b_shipment(
  p_commande_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_commande record;
  v_doc record;
  v_void_result jsonb;
  v_voided_count int := 0;
BEGIN
  -- ═══ 1. Lock commande ═══
  SELECT * INTO v_commande
  FROM commandes
  WHERE id = p_commande_id
  FOR UPDATE;

  IF v_commande IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COMMANDE_NOT_FOUND');
  END IF;

  -- ═══ 2. Guard: must be expediee ═══
  IF v_commande.status != 'expediee' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATUS',
      'message', 'Annulation impossible : la commande n''est pas en statut expédiée.',
      'current_status', v_commande.status::text);
  END IF;

  -- ═══ 3. Guard: no open litiges ═══
  IF EXISTS (
    SELECT 1 FROM litiges
    WHERE commande_id = p_commande_id AND status = 'open'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OPEN_LITIGE',
      'message', 'Annulation impossible : un litige est en cours sur cette commande.');
  END IF;

  -- ═══ 4. Guard: not received ═══
  IF v_commande.received_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_RECEIVED',
      'message', 'Annulation impossible : la commande a déjà été réceptionnée.');
  END IF;

  -- ═══ 5. Void all POSTED stock documents linked to this commande ═══
  FOR v_doc IN
    SELECT id FROM stock_documents
    WHERE source_order_id = p_commande_id
      AND status = 'POSTED'
      AND type = 'WITHDRAWAL'
    ORDER BY created_at
  LOOP
    v_void_result := fn_void_stock_document(
      p_document_id := v_doc.id,
      p_voided_by := p_user_id,
      p_void_reason := 'Annulation expédition commande ' || v_commande.order_number
    );

    IF NOT (v_void_result->>'ok')::boolean THEN
      RAISE EXCEPTION 'VOID_FAILED: document %, error: %',
        v_doc.id, v_void_result->>'error';
    END IF;

    v_voided_count := v_voided_count + 1;
  END LOOP;

  -- ═══ 6. Reset commande_lines ═══
  UPDATE commande_lines
  SET shipped_quantity = 0,
      line_status = NULL
  WHERE commande_id = p_commande_id;

  -- ═══ 7. Reset commande status to ouverte ═══
  UPDATE commandes
  SET status = 'ouverte',
      shipped_by = NULL,
      shipped_at = NULL,
      updated_at = now()
  WHERE id = p_commande_id;

  RETURN jsonb_build_object(
    'ok', true,
    'voided_documents', v_voided_count,
    'commande_id', p_commande_id
  );
END;
$function$;
