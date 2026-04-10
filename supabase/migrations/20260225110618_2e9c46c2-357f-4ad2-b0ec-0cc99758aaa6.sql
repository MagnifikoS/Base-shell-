
-- ═══════════════════════════════════════════════════════════════════════════
-- Cross-Org Commandes: RPCs + Notification fix
-- Additive only — no existing RLS/table modification
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. RPC: List active supplier partners for a client establishment
-- Returns suppliers with active relationship + their profile info
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cross_org_supplier_partners(
  p_client_establishment_id UUID
)
RETURNS TABLE(
  supplier_establishment_id UUID,
  supplier_name TEXT,
  supplier_logo_url TEXT,
  supplier_contact_email TEXT,
  relationship_id UUID
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Verify caller belongs to the client establishment
  IF NOT public.user_belongs_to_establishment(auth.uid(), p_client_establishment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: caller not in client establishment';
  END IF;

  RETURN QUERY
  SELECT
    sc.supplier_establishment_id,
    e.name AS supplier_name,
    ep.logo_url AS supplier_logo_url,
    ep.contact_email AS supplier_contact_email,
    sc.id AS relationship_id
  FROM supplier_clients sc
  JOIN establishments e ON e.id = sc.supplier_establishment_id
  LEFT JOIN establishment_profiles ep ON ep.establishment_id = sc.supplier_establishment_id
  WHERE sc.client_establishment_id = p_client_establishment_id
    AND sc.status = 'active';
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. RPC: Get catalog products for a cross-org supplier-client relationship
-- Only returns products in supplier_client_catalog_items (allowlist)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cross_org_catalog_products(
  p_supplier_establishment_id UUID,
  p_client_establishment_id UUID
)
RETURNS TABLE(
  id UUID,
  nom_produit TEXT,
  category TEXT,
  storage_zone_id UUID,
  stock_handling_unit_id UUID,
  final_unit_id UUID,
  delivery_unit_id UUID,
  supplier_billing_unit_id UUID,
  conditionnement_config JSONB,
  code_produit TEXT
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Verify caller belongs to the client establishment
  IF NOT public.user_belongs_to_establishment(auth.uid(), p_client_establishment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: caller not in client establishment';
  END IF;

  -- Verify active relationship exists
  IF NOT EXISTS (
    SELECT 1 FROM supplier_clients
    WHERE supplier_establishment_id = p_supplier_establishment_id
      AND client_establishment_id = p_client_establishment_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'NO_ACTIVE_RELATIONSHIP';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.nom_produit,
    p.category,
    p.storage_zone_id,
    p.stock_handling_unit_id,
    p.final_unit_id,
    p.delivery_unit_id,
    p.supplier_billing_unit_id,
    p.conditionnement_config,
    p.code_produit
  FROM supplier_client_catalog_items sci
  JOIN products_v2 p ON p.id = sci.product_id
  WHERE sci.supplier_establishment_id = p_supplier_establishment_id
    AND sci.client_establishment_id = p_client_establishment_id
    AND p.archived_at IS NULL
  ORDER BY p.nom_produit;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. RPC: Get measurement units from a cross-org supplier
-- Needed for quantity entry (ReceptionQuantityModal)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cross_org_supplier_units(
  p_supplier_establishment_id UUID,
  p_client_establishment_id UUID
)
RETURNS TABLE(
  id UUID,
  name TEXT,
  abbreviation TEXT,
  category TEXT,
  family TEXT,
  is_reference BOOLEAN,
  aliases TEXT[]
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Verify caller belongs to the client establishment
  IF NOT public.user_belongs_to_establishment(auth.uid(), p_client_establishment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: caller not in client establishment';
  END IF;

  -- Verify active relationship exists
  IF NOT EXISTS (
    SELECT 1 FROM supplier_clients
    WHERE supplier_establishment_id = p_supplier_establishment_id
      AND client_establishment_id = p_client_establishment_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'NO_ACTIVE_RELATIONSHIP';
  END IF;

  RETURN QUERY
  SELECT
    mu.id,
    mu.name,
    mu.abbreviation,
    mu.category,
    mu.family,
    mu.is_reference,
    mu.aliases
  FROM measurement_units mu
  WHERE mu.establishment_id = p_supplier_establishment_id
    AND mu.is_active = true
  ORDER BY mu.display_order;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. RPC: Get unit conversions from a cross-org supplier
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cross_org_supplier_conversions(
  p_supplier_establishment_id UUID,
  p_client_establishment_id UUID
)
RETURNS TABLE(
  id UUID,
  from_unit_id UUID,
  to_unit_id UUID,
  factor NUMERIC,
  establishment_id UUID,
  is_active BOOLEAN
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Verify caller belongs to the client establishment
  IF NOT public.user_belongs_to_establishment(auth.uid(), p_client_establishment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: caller not in client establishment';
  END IF;

  -- Verify active relationship exists
  IF NOT EXISTS (
    SELECT 1 FROM supplier_clients
    WHERE supplier_establishment_id = p_supplier_establishment_id
      AND client_establishment_id = p_client_establishment_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'NO_ACTIVE_RELATIONSHIP';
  END IF;

  RETURN QUERY
  SELECT
    uc.id,
    uc.from_unit_id,
    uc.to_unit_id,
    uc.factor,
    uc.establishment_id,
    uc.is_active
  FROM unit_conversions uc
  WHERE uc.establishment_id = p_supplier_establishment_id
    AND uc.is_active = true;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Fix fn_send_commande_notification: allow cross-org when relation active
-- Replace the CROSS_ORG check with a conditional supplier_clients check
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_send_commande_notification(p_alert_type text, p_order_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id UUID;
  v_caller_org UUID;
  v_order RECORD;
  v_source_name TEXT;
  v_dest_name TEXT;
  v_target_establishment_id UUID;
  v_rule_id UUID;
  v_order_num TEXT;
  v_title TEXT;
  v_body TEXT;
  v_inserted INT := 0;
  v_recipient RECORD;
  v_alert_key TEXT;
  v_valid_status TEXT[];
  v_is_cross_org BOOLEAN;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT e.organization_id INTO v_caller_org
  FROM user_establishments ue
  JOIN establishments e ON e.id = ue.establishment_id
  WHERE ue.user_id = v_caller_id
  LIMIT 1;

  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'NO_ORGANIZATION';
  END IF;

  SELECT po.id, po.organization_id, po.status,
         po.source_establishment_id, po.destination_establishment_id,
         src.name AS src_name, src.organization_id AS src_org,
         dst.name AS dst_name, dst.organization_id AS dst_org
  INTO v_order
  FROM product_orders po
  JOIN establishments src ON src.id = po.source_establishment_id
  JOIN establishments dst ON dst.id = po.destination_establishment_id
  WHERE po.id = p_order_id;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  -- Check if caller belongs to source or destination
  IF NOT (
    public.user_belongs_to_establishment(v_caller_id, v_order.source_establishment_id)
    OR public.user_belongs_to_establishment(v_caller_id, v_order.destination_establishment_id)
  ) THEN
    RAISE EXCEPTION 'CALLER_NOT_IN_ORDER';
  END IF;

  -- Cross-org detection
  v_is_cross_org := (v_order.src_org != v_order.dst_org);

  -- If cross-org, verify active supplier_clients relationship
  IF v_is_cross_org THEN
    IF NOT EXISTS (
      SELECT 1 FROM supplier_clients
      WHERE supplier_establishment_id = v_order.destination_establishment_id
        AND client_establishment_id = v_order.source_establishment_id
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'CROSS_ORG_NO_ACTIVE_RELATIONSHIP';
    END IF;
  END IF;

  v_source_name := v_order.src_name;
  v_dest_name := v_order.dst_name;
  v_order_num := UPPER(LEFT(v_order.id::text, 6));

  v_valid_status := CASE p_alert_type
    WHEN 'commande_recue' THEN ARRAY['sent']
    WHEN 'commande_expediee_complete' THEN ARRAY['shipped', 'preparing', 'prepared']
    WHEN 'commande_expediee_partielle' THEN ARRAY['shipped', 'preparing', 'prepared']
    WHEN 'commande_reception_validee_complete' THEN ARRAY['received', 'closed']
    WHEN 'commande_reception_validee_partielle' THEN ARRAY['received', 'closed']
    ELSE NULL
  END;

  IF v_valid_status IS NULL THEN
    RAISE EXCEPTION 'INVALID_ALERT_TYPE: %', p_alert_type;
  END IF;
  IF NOT (v_order.status = ANY(v_valid_status)) THEN
    RAISE EXCEPTION 'STATUS_MISMATCH: order "%" status "%" vs alert "%"', p_order_id, v_order.status, p_alert_type;
  END IF;

  IF p_alert_type = 'commande_recue' THEN
    v_target_establishment_id := v_order.destination_establishment_id;
    v_title := '📦 Commande #' || v_order_num || ' reçue';
    v_body := v_source_name || ' a passé une nouvelle commande';
  ELSIF p_alert_type = 'commande_expediee_complete' THEN
    v_target_establishment_id := v_order.source_establishment_id;
    v_title := '🚚 Commande #' || v_order_num || ' expédiée';
    v_body := v_dest_name || ' a expédié la commande #' || v_order_num || '.';
  ELSIF p_alert_type = 'commande_expediee_partielle' THEN
    v_target_establishment_id := v_order.source_establishment_id;
    v_title := '⚠️ Commande #' || v_order_num || ' expédiée partiellement';
    v_body := v_dest_name || ' a expédié la commande #' || v_order_num || '. Certains articles sont manquants ou en quantité réduite.';
  ELSIF p_alert_type = 'commande_reception_validee_complete' THEN
    v_target_establishment_id := v_order.destination_establishment_id;
    v_title := '✅ Réception confirmée — Commande #' || v_order_num;
    v_body := v_source_name || ' a confirmé la réception complète de la commande #' || v_order_num || '.';
  ELSIF p_alert_type = 'commande_reception_validee_partielle' THEN
    v_target_establishment_id := v_order.destination_establishment_id;
    v_title := '⚠️ Réception partielle signalée — Commande #' || v_order_num;
    v_body := v_source_name || ' a signalé une réception partielle de la commande #' || v_order_num || ' (écarts sur certains articles).';
  END IF;

  -- Use target org for notification rule lookup
  SELECT id INTO v_rule_id
  FROM notification_rules
  WHERE (
    (organization_id = v_order.src_org AND establishment_id IS NULL)
    OR (organization_id = v_order.dst_org AND establishment_id IS NULL)
  )
    AND alert_type = p_alert_type
    AND category = 'commande'
  LIMIT 1;

  IF v_rule_id IS NULL THEN
    -- Create rule in the TARGET establishment's org
    INSERT INTO notification_rules (
      establishment_id, organization_id, category, alert_type, enabled,
      recipient_role_ids, cooldown_minutes,
      active_start_time, active_end_time,
      title_template, body_template, min_severity, config, priority, scope
    ) VALUES (
      NULL::uuid,
      (SELECT organization_id FROM establishments WHERE id = v_target_establishment_id),
      'commande', p_alert_type, true,
      '{}'::uuid[], 0, '00:00'::time, '23:59'::time,
      '', '', 0, '{}'::jsonb, 100, 'establishment'
    ) RETURNING id INTO v_rule_id;
  END IF;

  FOR v_recipient IN
    SELECT DISTINCT ue.user_id
    FROM user_establishments ue
    JOIN user_roles ur ON ur.user_id = ue.user_id
      AND ur.establishment_id = v_target_establishment_id
    JOIN role_permissions rp_commande ON rp_commande.role_id = ur.role_id
      AND rp_commande.module_key = 'commandes'
      AND rp_commande.access_level IN ('read', 'write', 'full')
    JOIN role_permissions rp_notif ON rp_notif.role_id = ur.role_id
      AND rp_notif.module_key = 'notif_commande'
      AND rp_notif.access_level IN ('read', 'write', 'full')
    WHERE ue.establishment_id = v_target_establishment_id
      AND ue.user_id != v_caller_id
  LOOP
    v_alert_key := p_alert_type || ':' || p_order_id::text || ':' || v_recipient.user_id::text;

    INSERT INTO notification_events (
      rule_id, establishment_id, alert_key, alert_type,
      recipient_user_id, payload, incident_id
    ) VALUES (
      v_rule_id, v_target_establishment_id, v_alert_key, p_alert_type,
      v_recipient.user_id,
      jsonb_build_object(
        'title', v_title, 'body', v_body,
        'order_id', p_order_id::text,
        'source_establishment_name', v_source_name,
        'destination_establishment_name', v_dest_name,
        'engine_version', 'commande_v2',
        'is_cross_org', v_is_cross_org
      ),
      NULL
    )
    ON CONFLICT (establishment_id, alert_key, recipient_user_id) DO NOTHING;

    IF FOUND THEN
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$function$;
