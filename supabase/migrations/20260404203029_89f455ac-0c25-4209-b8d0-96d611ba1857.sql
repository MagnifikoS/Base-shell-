
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Add billing snapshot columns to app_invoice_lines
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.app_invoice_lines
  ADD COLUMN IF NOT EXISTS billed_unit_id uuid REFERENCES public.measurement_units(id),
  ADD COLUMN IF NOT EXISTS billed_unit_label text,
  ADD COLUMN IF NOT EXISTS billed_quantity numeric(14,4),
  ADD COLUMN IF NOT EXISTS billed_unit_price numeric(14,4);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Backfill existing lines (disable immutability trigger temporarily)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.app_invoice_lines DISABLE TRIGGER trg_app_invoice_lines_immutable;

-- Step 2a: Set billing unit info from product config
UPDATE app_invoice_lines ail
SET
  billed_unit_id = COALESCE(
    (p.conditionnement_config::jsonb -> 'priceLevel' ->> 'billed_unit_id')::uuid,
    p.supplier_billing_unit_id,
    ail.canonical_unit_id
  ),
  billed_unit_label = (
    SELECT COALESCE(mu.abbreviation, mu.name)
    FROM measurement_units mu
    WHERE mu.id = COALESCE(
      (p.conditionnement_config::jsonb -> 'priceLevel' ->> 'billed_unit_id')::uuid,
      p.supplier_billing_unit_id,
      ail.canonical_unit_id
    )
  ),
  billed_quantity = ail.quantity,
  billed_unit_price = ail.unit_price
FROM products_v2 p
WHERE p.id = ail.product_id
  AND ail.billed_unit_id IS NULL;

-- Step 2b: Apply forward conversion for lines where billing != canonical
UPDATE app_invoice_lines ail
SET
  billed_quantity = ROUND(ail.quantity * uc.factor, 4),
  billed_unit_price = ROUND(ail.unit_price / uc.factor, 4)
FROM unit_conversions uc
WHERE ail.billed_unit_id IS DISTINCT FROM ail.canonical_unit_id
  AND ail.billed_quantity = ail.quantity
  AND uc.from_unit_id = ail.canonical_unit_id
  AND uc.to_unit_id = ail.billed_unit_id
  AND uc.is_active = true;

-- Step 2c: Apply reverse conversion
UPDATE app_invoice_lines ail
SET
  billed_quantity = ROUND(ail.quantity / uc.factor, 4),
  billed_unit_price = ROUND(ail.unit_price * uc.factor, 4)
FROM unit_conversions uc
WHERE ail.billed_unit_id IS DISTINCT FROM ail.canonical_unit_id
  AND ail.billed_quantity = ail.quantity
  AND uc.from_unit_id = ail.billed_unit_id
  AND uc.to_unit_id = ail.canonical_unit_id
  AND uc.is_active = true;

ALTER TABLE public.app_invoice_lines ENABLE TRIGGER trg_app_invoice_lines_immutable;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Update fn_generate_app_invoice — snapshot billing in single INSERT
-- ═══════════════════════════════════════════════════════════════════════════

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
BEGIN
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

  SELECT count(*) INTO v_open_litiges
  FROM litiges
  WHERE commande_id = p_commande_id AND status = 'open';

  IF v_open_litiges > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'open_litiges',
      'count', v_open_litiges);
  END IF;

  SELECT count(*) INTO v_missing_price
  FROM commande_lines
  WHERE commande_id = p_commande_id AND unit_price_snapshot IS NULL;

  IF v_missing_price > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_price_snapshot',
      'count', v_missing_price);
  END IF;

  SELECT id INTO v_existing_invoice
  FROM app_invoices
  WHERE commande_id = p_commande_id;

  IF v_existing_invoice IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invoice_already_exists',
      'existing_invoice_id', v_existing_invoice);
  END IF;

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

  v_invoice_number := 'FAC-APP-' || lpad(nextval('app_invoice_seq')::text, 6, '0');

  SELECT COALESCE(SUM(
    ROUND(COALESCE(cl.received_quantity, 0) * cl.unit_price_snapshot, 2)
  ), 0)
  INTO v_total_ht
  FROM commande_lines cl
  WHERE cl.commande_id = p_commande_id
    AND COALESCE(cl.received_quantity, 0) > 0;

  SELECT count(*) INTO v_line_count
  FROM commande_lines cl
  WHERE cl.commande_id = p_commande_id
    AND COALESCE(cl.received_quantity, 0) > 0;

  IF v_line_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'all_lines_zero');
  END IF;

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

  -- Single INSERT with billing snapshot resolved inline
  -- Conversion: try forward (canonical→billing), then reverse (billing→canonical inverted), then identity
  INSERT INTO app_invoice_lines (
    app_invoice_id, commande_line_id, product_id,
    product_name_snapshot, quantity, unit_price, line_total,
    canonical_unit_id, unit_label_snapshot,
    billed_unit_id, billed_unit_label, billed_quantity, billed_unit_price
  )
  SELECT
    v_invoice_id, cl.id, cl.product_id,
    cl.product_name_snapshot,
    COALESCE(cl.received_quantity, 0),
    cl.unit_price_snapshot,
    ROUND(COALESCE(cl.received_quantity, 0) * cl.unit_price_snapshot, 2),
    cl.canonical_unit_id, cl.unit_label_snapshot,
    -- resolved billing unit id
    resolved.billing_id,
    -- billing unit label
    COALESCE(mu_bill.abbreviation, mu_bill.name, cl.unit_label_snapshot),
    -- billed_quantity
    CASE
      WHEN resolved.billing_id = cl.canonical_unit_id THEN COALESCE(cl.received_quantity, 0)
      WHEN uc_fwd.factor IS NOT NULL THEN ROUND(COALESCE(cl.received_quantity, 0) * uc_fwd.factor, 4)
      WHEN uc_rev.factor IS NOT NULL THEN ROUND(COALESCE(cl.received_quantity, 0) / uc_rev.factor, 4)
      ELSE COALESCE(cl.received_quantity, 0)
    END,
    -- billed_unit_price
    CASE
      WHEN resolved.billing_id = cl.canonical_unit_id THEN cl.unit_price_snapshot
      WHEN uc_fwd.factor IS NOT NULL THEN ROUND(cl.unit_price_snapshot / uc_fwd.factor, 4)
      WHEN uc_rev.factor IS NOT NULL THEN ROUND(cl.unit_price_snapshot * uc_rev.factor, 4)
      ELSE cl.unit_price_snapshot
    END
  FROM commande_lines cl
  JOIN products_v2 p ON p.id = cl.product_id
  -- Resolve billing unit: wizard config > denormalized column > canonical
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      (p.conditionnement_config::jsonb -> 'priceLevel' ->> 'billed_unit_id')::uuid,
      p.supplier_billing_unit_id,
      cl.canonical_unit_id
    ) AS billing_id
  ) resolved
  -- Label for the billing unit
  LEFT JOIN measurement_units mu_bill ON mu_bill.id = resolved.billing_id
  -- Forward conversion: canonical → billing
  LEFT JOIN unit_conversions uc_fwd
    ON uc_fwd.from_unit_id = cl.canonical_unit_id
    AND uc_fwd.to_unit_id = resolved.billing_id
    AND uc_fwd.is_active = true
    AND resolved.billing_id != cl.canonical_unit_id
  -- Reverse conversion: billing → canonical (invert)
  LEFT JOIN unit_conversions uc_rev
    ON uc_rev.from_unit_id = resolved.billing_id
    AND uc_rev.to_unit_id = cl.canonical_unit_id
    AND uc_rev.is_active = true
    AND resolved.billing_id != cl.canonical_unit_id
    AND uc_fwd.factor IS NULL
  WHERE cl.commande_id = p_commande_id
    AND COALESCE(cl.received_quantity, 0) > 0;

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Drop the cross-org RPC (no longer needed)
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_product_billing_config(uuid[]);
