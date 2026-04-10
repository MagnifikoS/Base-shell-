
CREATE OR REPLACE FUNCTION public.fn_enrich_b2b_invoices_vat_fr(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_order RECORD;
  v_inv RECORD;
  v_src_line RECORD;
  v_line_idx INT;
  v_sum_ht NUMERIC(12,2);
  v_sum_vat NUMERIC(12,2);
  v_sum_ttc NUMERIC(12,2);
  v_vat_rate NUMERIC(5,4);
  v_unit_price_ttc NUMERIC(12,4);
  v_line_total_ht NUMERIC(12,2);
  v_line_total_ttc NUMERIC(12,2);
  v_line_vat NUMERIC(12,2);
  v_enriched_count INT := 0;
  v_warnings TEXT := NULL;
  v_vat_enabled BOOLEAN;
BEGIN
  -- ═══ Feature toggle ═══
  v_vat_enabled := COALESCE(
    current_setting('app.vat_france_b2b_enabled', true),
    'false'
  ) = 'true';

  IF NOT v_vat_enabled THEN
    RETURN jsonb_build_object('ok', true, 'enriched', false, 'reason', 'VAT_TOGGLE_OFF');
  END IF;

  -- ═══ Load order ═══
  SELECT * INTO v_order FROM product_orders WHERE id = p_order_id;
  IF v_order IS NULL OR v_order.bl_retrait_document_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'enriched', false, 'reason', 'NO_ORDER_OR_BL');
  END IF;

  -- ═══ Process each B2B invoice ═══
  FOR v_inv IN
    SELECT id, b2b_status, vat_enriched_at
    FROM invoices
    WHERE b2b_order_id = p_order_id
      AND b2b_status IS NOT NULL
  LOOP
    IF v_inv.vat_enriched_at IS NOT NULL THEN
      CONTINUE;
    END IF;

    DELETE FROM b2b_invoice_lines WHERE invoice_id = v_inv.id;

    v_line_idx := 0;
    v_sum_ht := 0;
    v_sum_vat := 0;
    v_sum_ttc := 0;

    -- ═══ SOURCE ROUTING ═══
    IF v_inv.b2b_status = 'issued' THEN
      FOR v_src_line IN
        SELECT
          bwl.product_id,
          bwl.product_name_snapshot AS label,
          bwl.quantity_canonical AS qty,
          COALESCE(bwl.unit_price_snapshot, 0) AS unit_price_ht,
          LOWER(TRIM(COALESCE(p.category, ''))) AS cat_lower
        FROM bl_withdrawal_lines bwl
        LEFT JOIN products_v2 p ON p.id = bwl.product_id
        WHERE bwl.bl_withdrawal_document_id = v_order.bl_retrait_document_id
      LOOP
        -- ═══ CATEGORY → RATE (blocking on unknown) ═══
        IF v_src_line.cat_lower IN (
          'boissons (soft)', 'boulangerie / pâtisserie', 'café / thé',
          'charcuterie', 'condiments / sauces', 'crèmerie / produits laitiers',
          'épicerie sèche', 'fruits et légumes', 'huiles / vinaigres',
          'poissonnerie', 'surgelés', 'viandes / boucherie'
        ) THEN
          v_vat_rate := 0.055;
        ELSIF v_src_line.cat_lower IN (
          'hygiène / entretien', 'emballages / jetables', 'emballage'
        ) THEN
          v_vat_rate := 0.20;
        ELSIF v_src_line.cat_lower = '' OR v_src_line.cat_lower IS NULL THEN
          RAISE EXCEPTION '[TVA France] Catégorie produit manquante (NULL/vide) pour product_id=%. Corrigez la fiche produit.', v_src_line.product_id
            USING ERRCODE = 'data_exception';
        ELSE
          RAISE EXCEPTION '[TVA France] Catégorie inconnue "%" pour product_id=%. Aucun taux TVA configuré.', v_src_line.cat_lower, v_src_line.product_id
            USING ERRCODE = 'data_exception';
        END IF;

        v_unit_price_ttc := ROUND(v_src_line.unit_price_ht * (1 + v_vat_rate), 2);
        v_line_total_ht := ROUND(v_src_line.qty * v_src_line.unit_price_ht, 2);
        v_line_total_ttc := ROUND(v_src_line.qty * v_unit_price_ttc, 2);
        v_line_vat := v_line_total_ttc - v_line_total_ht;

        INSERT INTO b2b_invoice_lines (
          invoice_id, product_id, label_snapshot,
          quantity, vat_rate, unit_price_ht, unit_price_ttc,
          line_total_ht, vat_amount, line_total_ttc, line_index
        ) VALUES (
          v_inv.id, v_src_line.product_id, COALESCE(v_src_line.label, '—'),
          v_src_line.qty, v_vat_rate, v_src_line.unit_price_ht, v_unit_price_ttc,
          v_line_total_ht, v_line_vat, v_line_total_ttc, v_line_idx
        );

        v_sum_ht := v_sum_ht + v_line_total_ht;
        v_sum_vat := v_sum_vat + v_line_vat;
        v_sum_ttc := v_sum_ttc + v_line_total_ttc;
        v_line_idx := v_line_idx + 1;
      END LOOP;

    ELSIF v_inv.b2b_status = 'received' THEN
      FOR v_src_line IN
        SELECT
          bal.product_id,
          bal.product_name_snapshot AS label,
          bal.quantity_canonical AS qty,
          COALESCE(bal.unit_price, 0) AS unit_price_ht,
          LOWER(TRIM(COALESCE(p.category, ''))) AS cat_lower
        FROM bl_app_lines bal
        JOIN bl_app_documents bad ON bad.id = bal.bl_app_document_id
        JOIN stock_documents sd ON sd.id = bad.stock_document_id
        LEFT JOIN products_v2 p ON p.id = bal.product_id
        WHERE sd.idempotency_key = 'b2b-receipt-' || p_order_id::text
          AND sd.establishment_id = bal.establishment_id
      LOOP
        -- ═══ CATEGORY → RATE (blocking on unknown) ═══
        IF v_src_line.cat_lower IN (
          'boissons (soft)', 'boulangerie / pâtisserie', 'café / thé',
          'charcuterie', 'condiments / sauces', 'crèmerie / produits laitiers',
          'épicerie sèche', 'fruits et légumes', 'huiles / vinaigres',
          'poissonnerie', 'surgelés', 'viandes / boucherie'
        ) THEN
          v_vat_rate := 0.055;
        ELSIF v_src_line.cat_lower IN (
          'hygiène / entretien', 'emballages / jetables', 'emballage'
        ) THEN
          v_vat_rate := 0.20;
        ELSIF v_src_line.cat_lower = '' OR v_src_line.cat_lower IS NULL THEN
          RAISE EXCEPTION '[TVA France] Catégorie produit manquante (NULL/vide) pour product_id=%. Corrigez la fiche produit.', v_src_line.product_id
            USING ERRCODE = 'data_exception';
        ELSE
          RAISE EXCEPTION '[TVA France] Catégorie inconnue "%" pour product_id=%. Aucun taux TVA configuré.', v_src_line.cat_lower, v_src_line.product_id
            USING ERRCODE = 'data_exception';
        END IF;

        v_unit_price_ttc := ROUND(v_src_line.unit_price_ht * (1 + v_vat_rate), 2);
        v_line_total_ht := ROUND(v_src_line.qty * v_src_line.unit_price_ht, 2);
        v_line_total_ttc := ROUND(v_src_line.qty * v_unit_price_ttc, 2);
        v_line_vat := v_line_total_ttc - v_line_total_ht;

        INSERT INTO b2b_invoice_lines (
          invoice_id, product_id, label_snapshot,
          quantity, vat_rate, unit_price_ht, unit_price_ttc,
          line_total_ht, vat_amount, line_total_ttc, line_index
        ) VALUES (
          v_inv.id, v_src_line.product_id, COALESCE(v_src_line.label, '—'),
          v_src_line.qty, v_vat_rate, v_src_line.unit_price_ht, v_unit_price_ttc,
          v_line_total_ht, v_line_vat, v_line_total_ttc, v_line_idx
        );

        v_sum_ht := v_sum_ht + v_line_total_ht;
        v_sum_vat := v_sum_vat + v_line_vat;
        v_sum_ttc := v_sum_ttc + v_line_total_ttc;
        v_line_idx := v_line_idx + 1;
      END LOOP;
    END IF;

    -- ═══ Update invoice totals ═══
    IF v_line_idx > 0 THEN
      UPDATE invoices
      SET amount_ht = v_sum_ht,
          vat_amount = v_sum_vat,
          amount_eur = v_sum_ttc,
          vat_enriched_at = now()
      WHERE id = v_inv.id;
      v_enriched_count := v_enriched_count + 1;
    END IF;

  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'enriched', true,
    'invoice_count', v_enriched_count,
    'warnings', v_warnings
  );
END;
$fn$;
