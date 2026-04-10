
-- ═══════════════════════════════════════════════════════════════
-- COMMANDES B2B V0 — Tables, Enum, RPCs, RLS, Realtime
-- ═══════════════════════════════════════════════════════════════

-- 1) Enum
CREATE TYPE public.commande_status AS ENUM ('brouillon', 'envoyee', 'ouverte');

-- 2) Table commandes
CREATE TABLE public.commandes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  supplier_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  partnership_id UUID NOT NULL REFERENCES public.b2b_partnerships(id),
  status public.commande_status NOT NULL DEFAULT 'brouillon',
  note TEXT,
  created_by UUID NOT NULL,
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  opened_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_no_self_order CHECK (client_establishment_id <> supplier_establishment_id)
);

-- 3) Table commande_lines
CREATE TABLE public.commande_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  commande_id UUID NOT NULL REFERENCES public.commandes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  canonical_quantity NUMERIC NOT NULL CHECK (canonical_quantity > 0),
  canonical_unit_id UUID NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  unit_label_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_commande_product UNIQUE (commande_id, product_id)
);

-- 4) Indexes
CREATE INDEX idx_commandes_client ON public.commandes(client_establishment_id);
CREATE INDEX idx_commandes_supplier ON public.commandes(supplier_establishment_id);
CREATE INDEX idx_commande_lines_commande ON public.commande_lines(commande_id);

-- 5) Enable RLS
ALTER TABLE public.commandes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commande_lines ENABLE ROW LEVEL SECURITY;

-- 6) RLS policies for commandes
-- CL or FO can see their commandes (excluding brouillons of the other side)
CREATE POLICY "commandes_select" ON public.commandes
  FOR SELECT TO authenticated
  USING (
    client_establishment_id IN (SELECT public.get_user_establishment_ids())
    OR (
      supplier_establishment_id IN (SELECT public.get_user_establishment_ids())
      AND status <> 'brouillon'
    )
  );

-- Only CL can insert (as brouillon)
CREATE POLICY "commandes_insert" ON public.commandes
  FOR INSERT TO authenticated
  WITH CHECK (
    client_establishment_id IN (SELECT public.get_user_establishment_ids())
    AND status = 'brouillon'
  );

-- CL can update their own commandes (note only, via RPC for status)
CREATE POLICY "commandes_update" ON public.commandes
  FOR UPDATE TO authenticated
  USING (
    client_establishment_id IN (SELECT public.get_user_establishment_ids())
  );

-- CL can delete only brouillons
CREATE POLICY "commandes_delete" ON public.commandes
  FOR DELETE TO authenticated
  USING (
    client_establishment_id IN (SELECT public.get_user_establishment_ids())
    AND status = 'brouillon'
  );

-- 7) RLS policies for commande_lines
-- Lines visible if parent commande is visible
CREATE POLICY "commande_lines_select" ON public.commande_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.commandes c
      WHERE c.id = commande_id
      AND (
        c.client_establishment_id IN (SELECT public.get_user_establishment_ids())
        OR (
          c.supplier_establishment_id IN (SELECT public.get_user_establishment_ids())
          AND c.status <> 'brouillon'
        )
      )
    )
  );

-- CL can insert lines on their commandes
CREATE POLICY "commande_lines_insert" ON public.commande_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.commandes c
      WHERE c.id = commande_id
      AND c.client_establishment_id IN (SELECT public.get_user_establishment_ids())
    )
  );

-- CL can update lines on unlocked commandes
CREATE POLICY "commande_lines_update" ON public.commande_lines
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.commandes c
      WHERE c.id = commande_id
      AND c.client_establishment_id IN (SELECT public.get_user_establishment_ids())
      AND c.status <> 'ouverte'
    )
  );

-- CL can delete lines on unlocked commandes
CREATE POLICY "commande_lines_delete" ON public.commande_lines
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.commandes c
      WHERE c.id = commande_id
      AND c.client_establishment_id IN (SELECT public.get_user_establishment_ids())
      AND c.status <> 'ouverte'
    )
  );

-- 8) RPCs (SECURITY DEFINER — atomic transitions)

-- fn_send_commande: brouillon → envoyee (requires >= 1 line)
CREATE OR REPLACE FUNCTION public.fn_send_commande(p_commande_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status commande_status;
  v_line_count INT;
BEGIN
  -- Lock row
  SELECT status INTO v_status
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

  UPDATE commandes
  SET status = 'envoyee', sent_at = now(), updated_at = now()
  WHERE id = p_commande_id;

  RETURN jsonb_build_object('ok', true, 'line_count', v_line_count);
END;
$$;

-- fn_open_commande: envoyee → ouverte (idempotent)
CREATE OR REPLACE FUNCTION public.fn_open_commande(p_commande_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status commande_status;
BEGIN
  SELECT status INTO v_status
  FROM commandes
  WHERE id = p_commande_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_status = 'ouverte' THEN
    RETURN jsonb_build_object('ok', true, 'already_opened', true);
  END IF;

  IF v_status <> 'envoyee' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_envoyee');
  END IF;

  UPDATE commandes
  SET status = 'ouverte', opened_at = now(), opened_by = p_user_id, updated_at = now()
  WHERE id = p_commande_id;

  RETURN jsonb_build_object('ok', true, 'already_opened', false);
END;
$$;

-- fn_update_commande_if_unlocked: update note only if not yet ouverte
CREATE OR REPLACE FUNCTION public.fn_update_commande_if_unlocked(p_commande_id UUID, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status commande_status;
BEGIN
  SELECT status INTO v_status
  FROM commandes
  WHERE id = p_commande_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_status = 'ouverte' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'locked');
  END IF;

  UPDATE commandes
  SET note = p_note, updated_at = now()
  WHERE id = p_commande_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 9) updated_at trigger
CREATE OR REPLACE FUNCTION public.update_commandes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_commandes_updated_at
  BEFORE UPDATE ON public.commandes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_commandes_updated_at();

-- 10) Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.commandes;
