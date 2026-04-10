
-- ============================================================
-- B2B Partnership V0 — Tables + RLS + RPCs
-- ============================================================

-- 1. Table b2b_partnerships
CREATE TABLE public.b2b_partnerships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  client_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  archived_by UUID,
  CONSTRAINT uq_b2b_partnership_pair UNIQUE (supplier_establishment_id, client_establishment_id)
);

CREATE INDEX idx_b2b_partnerships_supplier ON public.b2b_partnerships(supplier_establishment_id);
CREATE INDEX idx_b2b_partnerships_client ON public.b2b_partnerships(client_establishment_id);

-- 2. Table b2b_invitation_codes
CREATE TABLE public.b2b_invitation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  supplier_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '48 hours'),
  used_at TIMESTAMPTZ,
  used_by_establishment_id UUID REFERENCES public.establishments(id),
  partnership_id UUID REFERENCES public.b2b_partnerships(id)
);

CREATE INDEX idx_b2b_codes_supplier ON public.b2b_invitation_codes(supplier_establishment_id);
CREATE INDEX idx_b2b_codes_code ON public.b2b_invitation_codes(code);

-- 3. RLS
ALTER TABLE public.b2b_partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_invitation_codes ENABLE ROW LEVEL SECURITY;

-- Partnerships: visible if member of either establishment
CREATE POLICY "b2b_partnerships_select"
ON public.b2b_partnerships FOR SELECT TO authenticated
USING (
  supplier_establishment_id IN (SELECT public.get_user_establishment_ids())
  OR client_establishment_id IN (SELECT public.get_user_establishment_ids())
);

-- Partnerships: both sides can archive (update status)
CREATE POLICY "b2b_partnerships_update"
ON public.b2b_partnerships FOR UPDATE TO authenticated
USING (
  supplier_establishment_id IN (SELECT public.get_user_establishment_ids())
  OR client_establishment_id IN (SELECT public.get_user_establishment_ids())
)
WITH CHECK (
  supplier_establishment_id IN (SELECT public.get_user_establishment_ids())
  OR client_establishment_id IN (SELECT public.get_user_establishment_ids())
);

-- Codes: visible only by supplier creator
CREATE POLICY "b2b_codes_select"
ON public.b2b_invitation_codes FOR SELECT TO authenticated
USING (
  supplier_establishment_id IN (SELECT public.get_user_establishment_ids())
);

-- Codes: creation only by supplier
CREATE POLICY "b2b_codes_insert"
ON public.b2b_invitation_codes FOR INSERT TO authenticated
WITH CHECK (
  supplier_establishment_id IN (SELECT public.get_user_establishment_ids())
);

-- 4. RPC fn_redeem_b2b_code (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.fn_redeem_b2b_code(
  p_code TEXT,
  p_client_establishment_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation b2b_invitation_codes%ROWTYPE;
  v_partnership_id UUID;
  v_client_org UUID;
  v_supplier_org UUID;
BEGIN
  -- 1. Find code
  SELECT * INTO v_invitation
  FROM b2b_invitation_codes
  WHERE code = p_code
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_NOT_FOUND');
  END IF;
  
  -- 2. Check not used
  IF v_invitation.used_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_ALREADY_USED');
  END IF;
  
  -- 3. Check not expired
  IF v_invitation.expires_at < now() THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_EXPIRED');
  END IF;
  
  -- 4. Check cross-org
  SELECT organization_id INTO v_client_org FROM establishments WHERE id = p_client_establishment_id;
  SELECT organization_id INTO v_supplier_org FROM establishments WHERE id = v_invitation.supplier_establishment_id;
  
  IF v_client_org = v_supplier_org THEN
    RETURN json_build_object('ok', false, 'error', 'SAME_ORGANIZATION');
  END IF;
  
  -- 5. Check no duplicate
  IF EXISTS (
    SELECT 1 FROM b2b_partnerships
    WHERE supplier_establishment_id = v_invitation.supplier_establishment_id
      AND client_establishment_id = p_client_establishment_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'PARTNERSHIP_EXISTS');
  END IF;
  
  -- 6. Verify caller is member of client
  IF NOT EXISTS (
    SELECT 1 FROM get_user_establishment_ids() AS eid
    WHERE eid = p_client_establishment_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  
  -- 7. Create partnership
  INSERT INTO b2b_partnerships (supplier_establishment_id, client_establishment_id)
  VALUES (v_invitation.supplier_establishment_id, p_client_establishment_id)
  RETURNING id INTO v_partnership_id;
  
  -- 8. Mark code as used
  UPDATE b2b_invitation_codes
  SET used_at = now(),
      used_by_establishment_id = p_client_establishment_id,
      partnership_id = v_partnership_id
  WHERE id = v_invitation.id;
  
  RETURN json_build_object('ok', true, 'partnership_id', v_partnership_id);
END;
$$;

-- 5. RPC fn_get_b2b_partner_profile (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.fn_get_b2b_partner_profile(
  p_partner_establishment_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify active partnership exists with caller
  IF NOT EXISTS (
    SELECT 1 FROM b2b_partnerships bp
    WHERE bp.status = 'active'
      AND (
        (bp.supplier_establishment_id = p_partner_establishment_id
         AND bp.client_establishment_id IN (SELECT get_user_establishment_ids()))
        OR
        (bp.client_establishment_id = p_partner_establishment_id
         AND bp.supplier_establishment_id IN (SELECT get_user_establishment_ids()))
      )
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'NO_ACTIVE_PARTNERSHIP');
  END IF;
  
  -- Return read-only projection
  RETURN (
    SELECT json_build_object(
      'ok', true,
      'name', e.name,
      'trade_name', e.trade_name,
      'establishment_type', e.establishment_type,
      'logo_url', ep.logo_url,
      'legal_name', ep.legal_name,
      'city', ep.city,
      'contact_email', ep.contact_email,
      'contact_phone', ep.contact_phone,
      'siret', ep.siret
    )
    FROM establishments e
    LEFT JOIN establishment_profiles ep ON ep.establishment_id = e.id
    WHERE e.id = p_partner_establishment_id
  );
END;
$$;

-- 6. Register module
INSERT INTO modules (key, name) VALUES ('clients_b2b', 'Clients B2B')
ON CONFLICT (key) DO NOTHING;
