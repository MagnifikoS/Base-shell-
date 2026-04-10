
-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTAPE 1 — Facture App : Tables app_invoices + app_invoice_lines + RLS
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Séquence dédiée Facture App (distincte de b2b_invoice_seq)
CREATE SEQUENCE IF NOT EXISTS public.app_invoice_seq START WITH 1 INCREMENT BY 1 NO CYCLE;

-- 2. Table en-tête facture
CREATE TABLE public.app_invoices (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number             text NOT NULL UNIQUE,
  commande_id                uuid NOT NULL REFERENCES public.commandes(id),
  order_number_snapshot      text NOT NULL,

  -- Émetteur (fournisseur)
  supplier_establishment_id  uuid NOT NULL REFERENCES public.establishments(id),
  -- Destinataire (client)
  client_establishment_id    uuid NOT NULL REFERENCES public.establishments(id),

  -- Snapshots en-tête (figés à la génération, jamais recalculés)
  supplier_name_snapshot     text NOT NULL,
  supplier_address_snapshot  text,
  supplier_siret_snapshot    text,
  supplier_logo_url_snapshot text,
  client_name_snapshot       text NOT NULL,
  client_address_snapshot    text,
  client_siret_snapshot      text,

  -- Montants
  total_ht                   numeric(12,2) NOT NULL DEFAULT 0,
  -- Préparé pour TVA future (nullable V0)
  vat_rate                   numeric(5,2),
  vat_amount                 numeric(12,2),
  total_ttc                  numeric(12,2),

  -- Dates
  invoice_date               date NOT NULL DEFAULT CURRENT_DATE,
  commande_date_snapshot     date,

  -- Métadonnées
  status                     text NOT NULL DEFAULT 'emise',
  created_by                 uuid NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),

  -- 1 facture max par commande
  CONSTRAINT app_invoices_one_per_commande UNIQUE (commande_id)
);

-- 3. Table lignes de facture
CREATE TABLE public.app_invoice_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_invoice_id        uuid NOT NULL REFERENCES public.app_invoices(id) ON DELETE CASCADE,
  commande_line_id      uuid NOT NULL REFERENCES public.commande_lines(id),

  -- Snapshots produit (copiés depuis commande_lines)
  product_id            uuid NOT NULL,
  product_name_snapshot text NOT NULL,
  unit_label_snapshot   text,
  canonical_unit_id     uuid NOT NULL REFERENCES public.measurement_units(id),

  -- Valeurs facturées (IMMUABLES, copiées depuis commande_lines snapshots)
  quantity              numeric NOT NULL,
  unit_price            numeric(12,4) NOT NULL,
  line_total            numeric(12,2) NOT NULL,

  created_at            timestamptz NOT NULL DEFAULT now()
);

-- 4. Index pour les vues fournisseur et client
CREATE INDEX idx_app_invoices_supplier ON public.app_invoices(supplier_establishment_id, invoice_date DESC);
CREATE INDEX idx_app_invoices_client ON public.app_invoices(client_establishment_id, invoice_date DESC);
CREATE INDEX idx_app_invoice_lines_invoice ON public.app_invoice_lines(app_invoice_id);

-- 5. RLS
ALTER TABLE public.app_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_invoice_lines ENABLE ROW LEVEL SECURITY;

-- app_invoices : le fournisseur voit ses factures émises
CREATE POLICY "app_invoices_supplier_select" ON public.app_invoices
  FOR SELECT TO authenticated
  USING (supplier_establishment_id IN (SELECT public.get_user_establishment_ids()));

-- app_invoices : le client voit ses factures reçues
CREATE POLICY "app_invoices_client_select" ON public.app_invoices
  FOR SELECT TO authenticated
  USING (client_establishment_id IN (SELECT public.get_user_establishment_ids()));

-- app_invoices : seul le fournisseur peut insérer
CREATE POLICY "app_invoices_supplier_insert" ON public.app_invoices
  FOR INSERT TO authenticated
  WITH CHECK (supplier_establishment_id IN (SELECT public.get_user_establishment_ids()));

-- app_invoices : seul le fournisseur peut mettre à jour (status uniquement, via RPC)
CREATE POLICY "app_invoices_supplier_update" ON public.app_invoices
  FOR UPDATE TO authenticated
  USING (supplier_establishment_id IN (SELECT public.get_user_establishment_ids()));

-- app_invoice_lines : visible si la facture parente est visible (via jointure)
CREATE POLICY "app_invoice_lines_select" ON public.app_invoice_lines
  FOR SELECT TO authenticated
  USING (
    app_invoice_id IN (
      SELECT id FROM public.app_invoices
      WHERE supplier_establishment_id IN (SELECT public.get_user_establishment_ids())
         OR client_establishment_id IN (SELECT public.get_user_establishment_ids())
    )
  );

-- app_invoice_lines : seul le fournisseur peut insérer
CREATE POLICY "app_invoice_lines_insert" ON public.app_invoice_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    app_invoice_id IN (
      SELECT id FROM public.app_invoices
      WHERE supplier_establishment_id IN (SELECT public.get_user_establishment_ids())
    )
  );

-- 6. Trigger d'immutabilité sur les lignes de facture (aucune modification possible)
CREATE OR REPLACE FUNCTION public.trg_app_invoice_lines_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'app_invoice_lines are immutable once created';
END;
$$;

CREATE TRIGGER trg_app_invoice_lines_immutable
  BEFORE UPDATE ON public.app_invoice_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_app_invoice_lines_immutable();

-- 7. Trigger d'immutabilité sur les champs critiques de app_invoices
CREATE OR REPLACE FUNCTION public.trg_app_invoices_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number THEN
    RAISE EXCEPTION 'invoice_number is immutable';
  END IF;
  IF NEW.commande_id IS DISTINCT FROM OLD.commande_id THEN
    RAISE EXCEPTION 'commande_id is immutable';
  END IF;
  IF NEW.total_ht IS DISTINCT FROM OLD.total_ht THEN
    RAISE EXCEPTION 'total_ht is immutable';
  END IF;
  IF NEW.supplier_establishment_id IS DISTINCT FROM OLD.supplier_establishment_id THEN
    RAISE EXCEPTION 'supplier_establishment_id is immutable';
  END IF;
  IF NEW.client_establishment_id IS DISTINCT FROM OLD.client_establishment_id THEN
    RAISE EXCEPTION 'client_establishment_id is immutable';
  END IF;
  -- Seul 'status' peut changer (emise → annulee)
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_app_invoices_immutable_fields
  BEFORE UPDATE ON public.app_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_app_invoices_immutable_fields();
