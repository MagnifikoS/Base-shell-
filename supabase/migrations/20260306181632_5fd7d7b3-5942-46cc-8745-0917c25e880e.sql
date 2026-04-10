
-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTAPE 2 — Facture App : RPC fn_generate_app_invoice (SECURITY DEFINER)
-- Génération atomique d'une facture à partir d'une commande validée.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_generate_app_invoice(
  p_commande_id uuid,
  p_user_id uuid
)
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
  -- ═══ 1. Lock & fetch commande ═══
  SELECT c.id, c.status, c.order_number, c.created_at::date AS commande_date,
         c.supplier_establishment_id, c.client_establishment_id
  INTO v_commande
  FROM commandes c
  WHERE c.id = p_commande_id
  FOR UPDATE;

  IF v_commande.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'commande_not_found');
  END IF;

  -- ═══ 2. Validation métier : statut ═══
  -- La commande doit être au statut 'recue' (réception terminée)
  -- OU 'cloturee' (si déjà clôturée mais pas encore facturée)
  IF v_commande.status NOT IN ('recue', 'cloturee') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'commande_not_received',
      'current_status', v_commande.status);
  END IF;

  -- ═══ 3. Validation métier : pas de litige ouvert ═══
  SELECT count(*) INTO v_open_litiges
  FROM litiges
  WHERE commande_id = p_commande_id AND status = 'open';

  IF v_open_litiges > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'open_litiges',
      'count', v_open_litiges);
  END IF;

  -- ═══ 4. Validation métier : toutes les lignes ont un prix figé ═══
  SELECT count(*) INTO v_missing_price
  FROM commande_lines
  WHERE commande_id = p_commande_id AND unit_price_snapshot IS NULL;

  IF v_missing_price > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_price_snapshot',
      'count', v_missing_price);
  END IF;

  -- ═══ 5. Validation métier : pas de facture existante pour cette commande ═══
  SELECT id INTO v_existing_invoice
  FROM app_invoices
  WHERE commande_id = p_commande_id;

  IF v_existing_invoice IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invoice_already_exists',
      'existing_invoice_id', v_existing_invoice);
  END IF;

  -- ═══ 6. Récupérer les profils fournisseur et client (snapshots) ═══
  SELECT
    COALESCE(ep.legal_name, e.name) AS name,
    CONCAT_WS(', ',
      NULLIF(ep.address_line1, ''),
      NULLIF(ep.postal_code, ''),
      NULLIF(ep.city, '')
    ) AS address,
    ep.siret,
    ep.logo_url
  INTO v_supplier_profile
  FROM establishments e
  LEFT JOIN establishment_profiles ep ON ep.establishment_id = e.id
  WHERE e.id = v_commande.supplier_establishment_id;

  SELECT
    COALESCE(ep.legal_name, e.name) AS name,
    CONCAT_WS(', ',
      NULLIF(ep.address_line1, ''),
      NULLIF(ep.postal_code, ''),
      NULLIF(ep.city, '')
    ) AS address,
    ep.siret
  INTO v_client_profile
  FROM establishments e
  LEFT JOIN establishment_profiles ep ON ep.establishment_id = e.id
  WHERE e.id = v_commande.client_establishment_id;

  -- ═══ 7. Générer le numéro de facture ═══
  v_invoice_number := 'FAC-APP-' || lpad(nextval('app_invoice_seq')::text, 6, '0');

  -- ═══ 8. Calculer le total HT depuis les lignes ═══
  -- quantity = received_quantity (ou 0 si NULL/rupture)
  -- unit_price = unit_price_snapshot (figé à l'envoi)
  SELECT COALESCE(SUM(
    ROUND(COALESCE(cl.received_quantity, 0) * cl.unit_price_snapshot, 2)
  ), 0)
  INTO v_total_ht
  FROM commande_lines cl
  WHERE cl.commande_id = p_commande_id
    AND COALESCE(cl.received_quantity, 0) > 0;

  -- ═══ 9. Insérer l'en-tête facture ═══
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
    v_supplier_profile.siret,
    v_supplier_profile.logo_url,
    COALESCE(v_client_profile.name, 'Client'),
    NULLIF(v_client_profile.address, ''),
    v_client_profile.siret,
    v_total_ht, v_commande.commande_date, p_user_id
  );

  -- ═══ 10. Insérer les lignes de facture ═══
  -- Seules les lignes avec received_quantity > 0 sont facturées
  INSERT INTO app_invoice_lines (
    app_invoice_id, commande_line_id,
    product_id, product_name_snapshot, unit_label_snapshot, canonical_unit_id,
    quantity, unit_price, line_total
  )
  SELECT
    v_invoice_id, cl.id,
    cl.product_id, cl.product_name_snapshot, cl.unit_label_snapshot, cl.canonical_unit_id,
    cl.received_quantity,
    cl.unit_price_snapshot,
    ROUND(cl.received_quantity * cl.unit_price_snapshot, 2)
  FROM commande_lines cl
  WHERE cl.commande_id = p_commande_id
    AND COALESCE(cl.received_quantity, 0) > 0;

  GET DIAGNOSTICS v_line_count = ROW_COUNT;

  IF v_line_count = 0 THEN
    -- Toutes les lignes étaient en rupture → annuler
    DELETE FROM app_invoices WHERE id = v_invoice_id;
    RETURN jsonb_build_object('ok', false, 'error', 'all_lines_zero');
  END IF;

  -- ═══ 11. Retourner le résultat ═══
  RETURN jsonb_build_object(
    'ok', true,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'total_ht', v_total_ht,
    'line_count', v_line_count
  );
END;
$$;
