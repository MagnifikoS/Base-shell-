
-- =====================================================================
-- COMMANDE PLATS V1 — Étape 1 : Structure DB isolée
-- AUCUNE table existante n'est modifiée.
-- =====================================================================

-- 1) Enum dédié pour le statut des commandes plats
CREATE TYPE public.commande_plat_status AS ENUM (
  'brouillon', 'envoyee', 'ouverte', 'expediee', 'recue', 'litige', 'cloturee'
);

-- 2) Table de groupement visuel — relie commande produit + commande plat
--    sans toucher à la table commandes existante
CREATE TABLE public.order_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  supplier_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  partnership_id UUID NOT NULL REFERENCES public.b2b_partnerships(id),
  commande_id UUID REFERENCES public.commandes(id),          -- nullable, lien optionnel vers commande produit
  commande_plat_id UUID,                                       -- sera FK après création de commande_plats
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Table commande_plats — entièrement séparée de commandes
CREATE TABLE public.commande_plats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  supplier_establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  partnership_id UUID NOT NULL REFERENCES public.b2b_partnerships(id),
  status public.commande_plat_status NOT NULL DEFAULT 'brouillon',
  note TEXT,
  created_by UUID NOT NULL,
  created_by_name_snapshot TEXT,
  order_number TEXT,
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  opened_by UUID,
  shipped_at TIMESTAMPTZ,
  shipped_by UUID,
  received_at TIMESTAMPTZ,
  received_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Now add FK from order_groups to commande_plats
ALTER TABLE public.order_groups
  ADD CONSTRAINT order_groups_commande_plat_id_fkey
  FOREIGN KEY (commande_plat_id) REFERENCES public.commande_plats(id);

-- 4) Table commande_plat_lines — pointe vers b2b_recipe_listings, JAMAIS vers products_v2
CREATE TABLE public.commande_plat_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_plat_id UUID NOT NULL REFERENCES public.commande_plats(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES public.b2b_recipe_listings(id),
  quantity INT NOT NULL DEFAULT 1,
  commercial_name_snapshot TEXT NOT NULL,
  unit_price_snapshot NUMERIC(10,2) NOT NULL DEFAULT 0,
  line_total_snapshot NUMERIC(10,2),
  portions_snapshot INT,
  shipped_quantity INT,
  received_quantity INT,
  line_status TEXT DEFAULT 'ok',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5) Table litige_plats — séparée de litiges (produits)
CREATE TABLE public.litige_plats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_plat_id UUID NOT NULL REFERENCES public.commande_plats(id),
  created_by UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'ouvert',
  note TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT litige_plats_commande_plat_id_key UNIQUE (commande_plat_id)
);

-- 6) Table litige_plat_lines — séparée de litige_lines (produits)
CREATE TABLE public.litige_plat_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  litige_plat_id UUID NOT NULL REFERENCES public.litige_plats(id) ON DELETE CASCADE,
  commande_plat_line_id UUID NOT NULL REFERENCES public.commande_plat_lines(id),
  shipped_quantity INT NOT NULL,
  received_quantity INT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- RLS — Toutes les nouvelles tables
-- =====================================================================

ALTER TABLE public.order_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commande_plats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commande_plat_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.litige_plats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.litige_plat_lines ENABLE ROW LEVEL SECURITY;

-- order_groups: visible par les deux parties du partenariat
CREATE POLICY "order_groups_select" ON public.order_groups
  FOR SELECT TO authenticated
  USING (
    client_establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
    OR supplier_establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "order_groups_insert" ON public.order_groups
  FOR INSERT TO authenticated
  WITH CHECK (
    client_establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "order_groups_update" ON public.order_groups
  FOR UPDATE TO authenticated
  USING (
    client_establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
    OR supplier_establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

-- commande_plats: visible par client et fournisseur
CREATE POLICY "commande_plats_select" ON public.commande_plats
  FOR SELECT TO authenticated
  USING (
    client_establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
    OR supplier_establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "commande_plats_insert" ON public.commande_plats
  FOR INSERT TO authenticated
  WITH CHECK (
    client_establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "commande_plats_update" ON public.commande_plats
  FOR UPDATE TO authenticated
  USING (
    client_establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
    OR supplier_establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "commande_plats_delete" ON public.commande_plats
  FOR DELETE TO authenticated
  USING (
    status = 'brouillon'
    AND client_establishment_id IN (
      SELECT e.id FROM establishments e
      JOIN profiles p ON p.organization_id = e.organization_id
      WHERE p.user_id = auth.uid()
    )
  );

-- commande_plat_lines: via le parent commande_plats
CREATE POLICY "commande_plat_lines_select" ON public.commande_plat_lines
  FOR SELECT TO authenticated
  USING (
    commande_plat_id IN (
      SELECT cp.id FROM commande_plats cp
      WHERE cp.client_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
      OR cp.supplier_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "commande_plat_lines_insert" ON public.commande_plat_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    commande_plat_id IN (
      SELECT cp.id FROM commande_plats cp
      WHERE cp.status = 'brouillon'
      AND cp.client_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "commande_plat_lines_update" ON public.commande_plat_lines
  FOR UPDATE TO authenticated
  USING (
    commande_plat_id IN (
      SELECT cp.id FROM commande_plats cp
      WHERE cp.client_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
      OR cp.supplier_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "commande_plat_lines_delete" ON public.commande_plat_lines
  FOR DELETE TO authenticated
  USING (
    commande_plat_id IN (
      SELECT cp.id FROM commande_plats cp
      WHERE cp.status = 'brouillon'
      AND cp.client_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
    )
  );

-- litige_plats: via commande_plats
CREATE POLICY "litige_plats_select" ON public.litige_plats
  FOR SELECT TO authenticated
  USING (
    commande_plat_id IN (
      SELECT cp.id FROM commande_plats cp
      WHERE cp.client_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
      OR cp.supplier_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "litige_plats_insert" ON public.litige_plats
  FOR INSERT TO authenticated
  WITH CHECK (
    commande_plat_id IN (
      SELECT cp.id FROM commande_plats cp
      WHERE cp.client_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "litige_plats_update" ON public.litige_plats
  FOR UPDATE TO authenticated
  USING (
    commande_plat_id IN (
      SELECT cp.id FROM commande_plats cp
      WHERE cp.client_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
      OR cp.supplier_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
    )
  );

-- litige_plat_lines: via litige_plats
CREATE POLICY "litige_plat_lines_select" ON public.litige_plat_lines
  FOR SELECT TO authenticated
  USING (
    litige_plat_id IN (
      SELECT lp.id FROM litige_plats lp
      JOIN commande_plats cp ON cp.id = lp.commande_plat_id
      WHERE cp.client_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
      OR cp.supplier_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "litige_plat_lines_insert" ON public.litige_plat_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    litige_plat_id IN (
      SELECT lp.id FROM litige_plats lp
      JOIN commande_plats cp ON cp.id = lp.commande_plat_id
      WHERE cp.client_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "litige_plat_lines_update" ON public.litige_plat_lines
  FOR UPDATE TO authenticated
  USING (
    litige_plat_id IN (
      SELECT lp.id FROM litige_plats lp
      JOIN commande_plats cp ON cp.id = lp.commande_plat_id
      WHERE cp.client_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
      OR cp.supplier_establishment_id IN (
        SELECT e.id FROM establishments e
        JOIN profiles p ON p.organization_id = e.organization_id
        WHERE p.user_id = auth.uid()
      )
    )
  );

-- Index pour les requêtes courantes
CREATE INDEX idx_order_groups_client ON public.order_groups(client_establishment_id);
CREATE INDEX idx_order_groups_supplier ON public.order_groups(supplier_establishment_id);
CREATE INDEX idx_commande_plats_client ON public.commande_plats(client_establishment_id);
CREATE INDEX idx_commande_plats_supplier ON public.commande_plats(supplier_establishment_id);
CREATE INDEX idx_commande_plats_status ON public.commande_plats(status);
CREATE INDEX idx_commande_plat_lines_parent ON public.commande_plat_lines(commande_plat_id);
CREATE INDEX idx_litige_plats_parent ON public.litige_plats(commande_plat_id);
CREATE INDEX idx_litige_plat_lines_parent ON public.litige_plat_lines(litige_plat_id);
