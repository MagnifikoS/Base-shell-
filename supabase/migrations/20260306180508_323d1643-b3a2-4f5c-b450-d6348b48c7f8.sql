
-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTAPE 0 — Facture App : Figer le prix sur les lignes de commande
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Ajouter les colonnes de prix snapshot sur commande_lines
ALTER TABLE public.commande_lines
  ADD COLUMN IF NOT EXISTS unit_price_snapshot numeric,
  ADD COLUMN IF NOT EXISTS line_total_snapshot numeric;

-- 2. Mettre à jour fn_send_commande pour figer les prix à l'envoi
CREATE OR REPLACE FUNCTION public.fn_send_commande(p_commande_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status commande_status;
  v_line_count INT;
  v_created_by uuid;
  v_display_name text;
  v_order_number text;
  v_missing_price_count INT;
BEGIN
  -- Lock row
  SELECT status, created_by INTO v_status, v_created_by
  FROM commandes
  WHERE id = p_commande_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_status <> 'brouillon' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_brouillon');
  END IF;

  SELECT count(*) INTO v_line_count
  FROM commande_lines
  WHERE commande_id = p_commande_id;

  IF v_line_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_lines');
  END IF;

  -- ── ÉTAPE 0 : Figer les prix depuis products_v2.final_unit_price ──
  UPDATE commande_lines cl
  SET unit_price_snapshot = p.final_unit_price,
      line_total_snapshot = ROUND(cl.canonical_quantity * COALESCE(p.final_unit_price, 0), 2)
  FROM products_v2 p
  WHERE cl.commande_id = p_commande_id
    AND cl.product_id = p.id;

  -- Vérifier qu'aucun prix n'est NULL (produit supprimé ou sans prix)
  SELECT count(*) INTO v_missing_price_count
  FROM commande_lines
  WHERE commande_id = p_commande_id
    AND unit_price_snapshot IS NULL;

  IF v_missing_price_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_price', 'count', v_missing_price_count);
  END IF;

  -- P1: Resolve creator display name from profiles (snapshot)
  SELECT COALESCE(p.second_first_name, split_part(p.full_name, ' ', 1), p.full_name)
  INTO v_display_name
  FROM profiles p
  WHERE p.user_id = v_created_by AND p.status = 'active';

  -- P2: Generate unique order number
  v_order_number := 'CMD-' || lpad(nextval('commande_order_seq')::text, 6, '0');

  UPDATE commandes
  SET status = 'envoyee',
      sent_at = now(),
      updated_at = now(),
      created_by_name_snapshot = COALESCE(v_display_name, 'Utilisateur'),
      order_number = v_order_number
  WHERE id = p_commande_id;

  RETURN jsonb_build_object('ok', true, 'line_count', v_line_count, 'order_number', v_order_number);
END;
$$;

-- 3. Trigger d'immutabilité : empêcher toute modification des prix figés
CREATE OR REPLACE FUNCTION public.trg_commande_lines_immutable_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.unit_price_snapshot IS NOT NULL AND NEW.unit_price_snapshot IS DISTINCT FROM OLD.unit_price_snapshot THEN
    RAISE EXCEPTION 'unit_price_snapshot is immutable once assigned';
  END IF;
  IF OLD.line_total_snapshot IS NOT NULL AND NEW.line_total_snapshot IS DISTINCT FROM OLD.line_total_snapshot THEN
    RAISE EXCEPTION 'line_total_snapshot is immutable once assigned';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_commande_lines_immutable_price
  BEFORE UPDATE ON public.commande_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_commande_lines_immutable_price();
