
-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTAPE 1 — Ajout de 'cloturee' à commande_status + passage atomique
-- dans fn_generate_app_invoice
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Ajouter la valeur 'cloturee' à l'enum commande_status
ALTER TYPE public.commande_status ADD VALUE IF NOT EXISTS 'cloturee' AFTER 'recue';

-- 2) Mettre à jour fn_generate_app_invoice pour passer à 'cloturee' atomiquement
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
  -- Verrou exclusif sur la commande
  SELECT c.id, c.status, c.order_number, c.created_at::date AS commande_date,
         c.supplier_establishment_id, c.client_establishment_id
  INTO v_commande
  FROM commandes c
  WHERE c.id = p_commande_id
  FOR UPDATE;

  IF v_commande.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'commande_not_found');
  END IF;

  -- ═══ Seules les commandes 'recue' sont facturables ═══
  -- (cloturee = déjà facturée, donc rejetée ici)
  IF v_commande.status != 'recue' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'commande_not_received',
      'current_status', v_commande.status::text);
  END IF;

  -- Vérification litiges ouverts
  SELECT count(*) INTO v_open_litiges
  FROM litiges
  WHERE commande_id = p_commande_id AND status = 'open';

  IF v_open_litiges > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'open_litiges',
      'count', v_open_litiges);
  END IF;

  -- Vérification prix snapshot
  SELECT count(*) INTO v_missing_price
  FROM commande_lines
  WHERE commande_id = p_commande_id AND unit_price_snapshot IS NULL;

  IF v_missing_price > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_price_snapshot',
      'count', v_missing_price);
  END IF;

  -- Vérification facture existante (anti-doublon)
  SELECT id INTO v_existing_invoice
  FROM app_invoices
  WHERE commande_id = p_commande_id;

  IF v_existing_invoice IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invoice_already_exists',
      'existing_invoice_id', v_existing_invoice);
  END IF;

  -- Snapshots fournisseur
  SELECT
    COALESCE(ep.legal_name, e.name) AS name,
    CONCAT_WS(', ', NULLIF(ep.address_line1, ''), NULLIF(ep.postal_code, ''), NULLIF(ep.city, '')) AS address,
    ep.siret, ep.logo_url
  INTO v_supplier_profile
  FROM establishments e
  LEFT JOIN establishment_profiles ep ON ep.establishment_id = e.id
  WHERE e.id = v_commande.supplier_establishment_id;

  -- Snapshots client
  SELECT
    COALESCE(ep.legal_name, e.name) AS name,
    CONCAT_WS(', ', NULLIF(ep.address_line1, ''), NULLIF(ep.postal_code, ''), NULLIF(ep.city, '')) AS address,
    ep.siret
  INTO v_client_profile
  FROM establishments e
  LEFT JOIN establishment_profiles ep ON ep.establishment_id = e.id
  WHERE e.id = v_commande.client_establishment_id;

  -- Numéro de facture
  v_invoice_number := 'FAC-APP-' || lpad(nextval('app_invoice_seq')::text, 6, '0');

  -- Calcul total HT
  SELECT COALESCE(SUM(
    ROUND(COALESCE(cl.received_quantity, 0) * cl.unit_price_snapshot, 2)
  ), 0)
  INTO v_total_ht
  FROM commande_lines cl
  WHERE cl.commande_id = p_commande_id
    AND COALESCE(cl.received_quantity, 0) > 0;

  -- Vérification lignes non nulles
  SELECT count(*) INTO v_line_count
  FROM commande_lines cl
  WHERE cl.commande_id = p_commande_id
    AND COALESCE(cl.received_quantity, 0) > 0;

  IF v_line_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'all_lines_zero');
  END IF;

  v_invoice_id := gen_random_uuid();

  -- Insertion facture
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

  -- Insertion lignes facture
  INSERT INTO app_invoice_lines (
    app_invoice_id, commande_line_id, product_id,
    product_name_snapshot, quantity, unit_price, line_total,
    canonical_unit_id, unit_label_snapshot
  )
  SELECT
    v_invoice_id, cl.id, cl.product_id,
    cl.product_name_snapshot,
    COALESCE(cl.received_quantity, 0),
    cl.unit_price_snapshot,
    ROUND(COALESCE(cl.received_quantity, 0) * cl.unit_price_snapshot, 2),
    cl.canonical_unit_id, cl.unit_label_snapshot
  FROM commande_lines cl
  WHERE cl.commande_id = p_commande_id
    AND COALESCE(cl.received_quantity, 0) > 0;

  -- ═══ NOUVEAU : passage atomique à 'cloturee' ═══
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
