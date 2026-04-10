
-- ═══════════════════════════════════════════════════════════════════════
-- Module Clients: Tables + RLS + RPCs
-- Architecture additive uniquement, aucune table existante modifiée
-- ═══════════════════════════════════════════════════════════════════════

-- 1. supplier_client_invitations
CREATE TABLE public.supplier_client_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  invitation_code varchar(12) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  status text NOT NULL DEFAULT 'pending',
  accepted_by_establishment_id uuid REFERENCES public.establishments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_sci_code ON public.supplier_client_invitations(invitation_code);
CREATE INDEX idx_sci_supplier ON public.supplier_client_invitations(supplier_establishment_id);

ALTER TABLE public.supplier_client_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier_read_own_invitations"
  ON public.supplier_client_invitations FOR SELECT TO authenticated
  USING (supplier_establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "supplier_insert_invitations"
  ON public.supplier_client_invitations FOR INSERT TO authenticated
  WITH CHECK (
    supplier_establishment_id IN (SELECT public.get_user_establishment_ids())
  );

CREATE POLICY "supplier_update_invitations"
  ON public.supplier_client_invitations FOR UPDATE TO authenticated
  USING (supplier_establishment_id IN (SELECT public.get_user_establishment_ids()))
  WITH CHECK (supplier_establishment_id IN (SELECT public.get_user_establishment_ids()));

-- Validation trigger (no CHECK for status since it's time-dependent)
CREATE OR REPLACE FUNCTION public.fn_supplier_invitation_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'accepted', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid invitation status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_supplier_invitation_validate
  BEFORE INSERT OR UPDATE ON public.supplier_client_invitations
  FOR EACH ROW EXECUTE FUNCTION public.fn_supplier_invitation_validate();

-- 2. supplier_clients
CREATE TABLE public.supplier_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  client_establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_establishment_id, client_establishment_id)
);

CREATE INDEX idx_sc_supplier ON public.supplier_clients(supplier_establishment_id);
CREATE INDEX idx_sc_client ON public.supplier_clients(client_establishment_id);

ALTER TABLE public.supplier_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_supplier_clients"
  ON public.supplier_clients FOR SELECT TO authenticated
  USING (
    supplier_establishment_id IN (SELECT public.get_user_establishment_ids())
    OR client_establishment_id IN (SELECT public.get_user_establishment_ids())
  );

-- No direct INSERT — only via accept_supplier_invitation RPC
CREATE POLICY "supplier_update_clients"
  ON public.supplier_clients FOR UPDATE TO authenticated
  USING (supplier_establishment_id IN (SELECT public.get_user_establishment_ids()))
  WITH CHECK (supplier_establishment_id IN (SELECT public.get_user_establishment_ids()));

-- Validation trigger
CREATE OR REPLACE FUNCTION public.fn_supplier_client_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Invalid supplier_client status: %', NEW.status;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_supplier_client_validate
  BEFORE INSERT OR UPDATE ON public.supplier_clients
  FOR EACH ROW EXECUTE FUNCTION public.fn_supplier_client_validate();

-- 3. supplier_client_catalog_items
CREATE TABLE public.supplier_client_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  client_establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products_v2(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_establishment_id, client_establishment_id, product_id)
);

ALTER TABLE public.supplier_client_catalog_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier_manage_catalog"
  ON public.supplier_client_catalog_items FOR ALL TO authenticated
  USING (supplier_establishment_id IN (SELECT public.get_user_establishment_ids()))
  WITH CHECK (supplier_establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "client_read_catalog"
  ON public.supplier_client_catalog_items FOR SELECT TO authenticated
  USING (
    client_establishment_id IN (SELECT public.get_user_establishment_ids())
    AND EXISTS (
      SELECT 1 FROM public.supplier_clients sc
      WHERE sc.supplier_establishment_id = supplier_client_catalog_items.supplier_establishment_id
        AND sc.client_establishment_id = supplier_client_catalog_items.client_establishment_id
        AND sc.status = 'active'
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- RPC: generate_supplier_invitation
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.generate_supplier_invitation(p_supplier_establishment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_code text;
  v_invitation_id uuid;
  v_attempts int := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.user_belongs_to_establishment(v_user_id, p_supplier_establishment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF NOT public.has_module_access('clients', 'write', p_supplier_establishment_id) THEN
    RAISE EXCEPTION 'MODULE_ACCESS_DENIED';
  END IF;

  SELECT organization_id INTO v_org_id
  FROM public.establishments
  WHERE id = p_supplier_establishment_id;

  LOOP
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 3))
           || '-'
           || upper(substr(md5(gen_random_uuid()::text), 1, 4));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.supplier_client_invitations WHERE invitation_code = v_code
    );
    v_attempts := v_attempts + 1;
    IF v_attempts > 10 THEN
      RAISE EXCEPTION 'CODE_GENERATION_FAILED';
    END IF;
  END LOOP;

  INSERT INTO public.supplier_client_invitations (
    supplier_establishment_id, organization_id, invitation_code, created_by
  ) VALUES (
    p_supplier_establishment_id, v_org_id, v_code, v_user_id
  ) RETURNING id INTO v_invitation_id;

  RETURN jsonb_build_object(
    'ok', true,
    'invitation_id', v_invitation_id,
    'invitation_code', v_code,
    'expires_at', (now() + interval '24 hours')::text
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- RPC: accept_supplier_invitation
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.accept_supplier_invitation(
  p_invitation_code text,
  p_client_establishment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_invitation RECORD;
  v_supplier_client_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- Verify user belongs to client establishment
  IF NOT public.user_belongs_to_establishment(v_user_id, p_client_establishment_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCESS_DENIED');
  END IF;

  -- Find invitation
  SELECT * INTO v_invitation
  FROM public.supplier_client_invitations
  WHERE invitation_code = upper(trim(p_invitation_code));

  IF v_invitation IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVITATION_NOT_FOUND');
  END IF;

  IF v_invitation.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVITATION_NOT_PENDING', 'status', v_invitation.status);
  END IF;

  IF v_invitation.expires_at < now() THEN
    UPDATE public.supplier_client_invitations SET status = 'expired' WHERE id = v_invitation.id;
    RETURN jsonb_build_object('ok', false, 'error', 'INVITATION_EXPIRED');
  END IF;

  -- Prevent self-linking
  IF p_client_establishment_id = v_invitation.supplier_establishment_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CANNOT_LINK_SELF');
  END IF;

  -- Check if relationship already exists
  IF EXISTS (
    SELECT 1 FROM public.supplier_clients
    WHERE supplier_establishment_id = v_invitation.supplier_establishment_id
      AND client_establishment_id = p_client_establishment_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_LINKED');
  END IF;

  -- Create the relationship
  INSERT INTO public.supplier_clients (
    supplier_establishment_id, client_establishment_id, organization_id
  ) VALUES (
    v_invitation.supplier_establishment_id, p_client_establishment_id, v_invitation.organization_id
  ) RETURNING id INTO v_supplier_client_id;

  -- Mark invitation as accepted
  UPDATE public.supplier_client_invitations
  SET status = 'accepted',
      accepted_by_establishment_id = p_client_establishment_id
  WHERE id = v_invitation.id;

  RETURN jsonb_build_object(
    'ok', true,
    'supplier_client_id', v_supplier_client_id,
    'supplier_establishment_id', v_invitation.supplier_establishment_id,
    'client_establishment_id', p_client_establishment_id
  );
END;
$$;
