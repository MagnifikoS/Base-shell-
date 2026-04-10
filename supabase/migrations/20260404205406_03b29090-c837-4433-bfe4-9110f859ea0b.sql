
-- ============================================================
-- Fix fn_generate_app_invoice: use real BFS engine instead of 1-hop JOIN
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_generate_app_invoice(p_commande_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commande RECORD;
  v_open_litiges INT;
  v_missing_price INT;
  v_existing_invoice uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_total_ht numeric(12,2);
  v_supplier_profile RECORD;
  v_client_profile RECORD;
  v_line_count INT;
  v_line RECORD;
  v_billing_id uuid;
  v_price_factor numeric;
  v_billed_qty numeric;
  v_billed_price numeric;
  v_billing_label text;
BEGIN
  -- ── 1. Validate commande ──
  SELECT c.id, c.status, c.order_number, c.created_at::date AS commande_date,
         c.supplier_establishment_id, c.client_establishment_id
  INTO v_commande
  FROM commandes c
  WHERE c.id = p_commande_id
  FOR UPDATE;

  IF v_commande.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'commande_not_found');
  END IF;

  IF v_commande.status != 'recue' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'commande_not_received',
      'current_status', v_commande.status::text);
  END IF;

  -- ── 2. Check open litiges ──
  SELECT count(*) INTO v_open_litiges
  FROM litiges
  WHERE commande_id = p_commande_id AND status = 'open';

  IF v_open_litiges > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'open_litiges',
      'count', v_open_litiges);
  END IF;

  -- ── 3. Check missing prices ──
  SELECT count(*) INTO v_missing_price
  FROM commande_lines
  WHERE commande_id = p_commande_id AND unit_price_snapshot IS NULL;

  IF v_missing_price > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_price_snapshot',
      'count', v_missing_price);
  END IF;

  -- ── 4. Check no duplicate invoice ──
  SELECT id INTO v_existing_invoice
  FROM app_invoices
  WHERE commande_id = p_commande_id;

  IF v_existing_invoice IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invoice_already_exists',
      'existing_invoice_id', v_existing_invoice);
  END IF;

  -- ── 5. Snapshot supplier/client profiles ──
  SELECT
    COALESCE(ep.legal_name, e.name) AS name,
    CONCAT_WS(', ', NULLIF(ep.address_line1, ''), NULLIF(ep.postal_code, ''), NULLIF(ep.city, '')) AS address,
    ep.siret, ep.logo_url
  INTO v_supplier_profile
  FROM establishments e
  LEFT JOIN establishment_profiles ep ON ep.establishment_id = e.id
  WHERE e.id = v_commande.supplier_establishment_id;

  SELECT
    COALESCE(ep.legal_name, e.name) AS name,
    CONCAT_WS(', ', NULLIF(ep.address_line1, ''), NULLIF(ep.postal_code, ''), NULLIF(ep.city, '')) AS address,
    ep.siret
  INTO v_client_profile
  FROM establishments e
  LEFT JOIN establishment_profiles ep ON ep.establishment_id = e.id
  WHERE e.id = v_commande.client_establishment_id;

  -- ── 6. Compute total_ht ──
  SELECT COALESCE(SUM(
    ROUND(COALESCE(cl.received_quantity, 0) * cl.unit_price_snapshot, 2)
  ), 0)
  INTO v_total_ht
  FROM commande_lines cl
  WHERE cl.commande_id = p_commande_id
    AND COALESCE(cl.received_quantity, 0) > 0;

  -- ── 7. Check at least one line ──
  SELECT count(*) INTO v_line_count
  FROM commande_lines cl
  WHERE cl.commande_id = p_commande_id
    AND COALESCE(cl.received_quantity, 0) > 0;

  IF v_line_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'all_lines_zero');
  END IF;

  -- ── 8. Create invoice header ──
  v_invoice_number := 'FAC-APP-' || lpad(nextval('app_invoice_seq')::text, 6, '0');
  v_invoice_id := gen_random_uuid();

  INSERT INTO app_invoices (
    id, invoice_number, commande_id, order_number_snapshot,
    supplier_establishment_id, client_establishment_id,
    supplier_name_snapshot, supplier_address_snapshot, supplier_siret_snapshot, supplier_logo_url_snapshot,
    client_name_snapshot, client_address_snapshot, client_siret_snapshot,
    total_ht, commande_date_snapshot, created_by
  ) VALUES (
    v_invoice_id, v_invoice_number, p_commande_id, v_commande.order_number,
    v_commande.supplier_establishment_id, v_commande.client_establishment_id,
    COALESCE(v_supplier_profile.name, 'Fournisseur'),
    NULLIF(v_supplier_profile.address, ''),
    v_supplier_profile.siret, v_supplier_profile.logo_url,
    COALESCE(v_client_profile.name, 'Client'),
    NULLIF(v_client_profile.address, ''),
    v_client_profile.siret,
    v_total_ht, v_commande.commande_date, p_user_id
  );

  -- ── 9. Insert invoice lines with BFS-projected billing snapshot ──
  FOR v_line IN
    SELECT cl.id AS line_id, cl.product_id, cl.product_name_snapshot,
           COALESCE(cl.received_quantity, 0) AS received_qty,
           cl.unit_price_snapshot, cl.canonical_unit_id, cl.unit_label_snapshot,
           COALESCE(
             (p.conditionnement_config::jsonb -> 'priceLevel' ->> 'billed_unit_id')::uuid,
             p.supplier_billing_unit_id,
             cl.canonical_unit_id
           ) AS resolved_billing_id
    FROM commande_lines cl
    JOIN products_v2 p ON p.id = cl.product_id
    WHERE cl.commande_id = p_commande_id
      AND COALESCE(cl.received_quantity, 0) > 0
  LOOP
    -- Resolve billing unit label
    SELECT COALESCE(mu.abbreviation, mu.name)
    INTO v_billing_label
    FROM measurement_units mu
    WHERE mu.id = v_line.resolved_billing_id;

    IF v_billing_label IS NULL THEN
      v_billing_label := v_line.unit_label_snapshot;
    END IF;

    -- Compute BFS factor: canonical → billing (PRICE semantics)
    IF v_line.resolved_billing_id = v_line.canonical_unit_id THEN
      -- Identity: no conversion needed
      v_price_factor := 1.0;
    ELSE
      -- Use the REAL BFS engine — multi-hop, packaging, equivalence
      v_price_factor := fn_product_unit_price_factor(
        v_line.product_id,
        v_line.canonical_unit_id,
        v_line.resolved_billing_id
      );

      -- ZERO FALLBACK: if BFS cannot find a path, ABORT
      IF v_price_factor IS NULL THEN
        RAISE EXCEPTION 'BFS_CONVERSION_FAILED: No conversion path from canonical_unit_id=% to billed_unit_id=% for product "%" (product_id=%)',
          v_line.canonical_unit_id, v_line.resolved_billing_id,
          v_line.product_name_snapshot, v_line.product_id;
      END IF;
    END IF;

    -- Price factor semantics:
    --   price_factor = price_per_billing / price_per_canonical
    --   billed_unit_price = unit_price_snapshot * price_factor
    --   billed_quantity   = received_qty / price_factor  (inverse for quantities)
    v_billed_price := ROUND(v_line.unit_price_snapshot * v_price_factor, 4);
    v_billed_qty   := ROUND(v_line.received_qty / v_price_factor, 4);

    INSERT INTO app_invoice_lines (
      app_invoice_id, commande_line_id, product_id,
      product_name_snapshot, quantity, unit_price, line_total,
      canonical_unit_id, unit_label_snapshot,
      billed_unit_id, billed_unit_label, billed_quantity, billed_unit_price
    ) VALUES (
      v_invoice_id, v_line.line_id, v_line.product_id,
      v_line.product_name_snapshot,
      v_line.received_qty,
      v_line.unit_price_snapshot,
      ROUND(v_line.received_qty * v_line.unit_price_snapshot, 2),
      v_line.canonical_unit_id, v_line.unit_label_snapshot,
      v_line.resolved_billing_id, v_billing_label, v_billed_qty, v_billed_price
    );
  END LOOP;

  -- ── 10. Close commande ──
  UPDATE commandes
  SET status = 'cloturee', updated_at = now()
  WHERE id = p_commande_id;

  RETURN jsonb_build_object(
    'ok', true,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'total_ht', v_total_ht
  );
END;
$$;

-- ============================================================
-- Drop the cross-org RPC workaround (if still exists)
-- ============================================================
DROP FUNCTION IF EXISTS public.get_product_billing_config(uuid[]);
