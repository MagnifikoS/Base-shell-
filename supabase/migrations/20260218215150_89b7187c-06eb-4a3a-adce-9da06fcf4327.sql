
-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1 — Module payLedger : 5 tables pay_* + RLS + triggers
-- EURO ONLY — APPEND-ONLY PAYMENTS — STATUT CALCULÉ (jamais stocké)
-- Zéro régression sur invoices / Vision AI / Achats
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. pay_invoices (dette comptable)
--    Rôle : représente une dette fournisseur (montant figé).
--    Lien optionnel vers invoices.id (document PDF existant).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.pay_invoices (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id UUID        NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  supplier_id      UUID        NOT NULL REFERENCES public.invoice_suppliers(id) ON DELETE RESTRICT,
  amount_eur       NUMERIC(12,2) NOT NULL,
  invoice_date     DATE        NOT NULL,
  label            TEXT        NULL,
  source_invoice_id UUID       NULL REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID        NOT NULL
);

CREATE INDEX idx_pay_invoices_est_sup ON public.pay_invoices(establishment_id, supplier_id, invoice_date);
CREATE UNIQUE INDEX idx_pay_invoices_source_uniq
  ON public.pay_invoices(establishment_id, supplier_id, source_invoice_id)
  WHERE source_invoice_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_pay_invoices_validate()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.amount_eur < 0 THEN
    RAISE EXCEPTION 'pay_invoices.amount_eur must be >= 0';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pay_invoices_validate
  BEFORE INSERT OR UPDATE ON public.pay_invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_pay_invoices_validate();

ALTER TABLE public.pay_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pay_invoices_select" ON public.pay_invoices
  FOR SELECT USING (establishment_id IN (SELECT public.get_user_establishment_ids()));
CREATE POLICY "pay_invoices_insert" ON public.pay_invoices
  FOR INSERT WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));
CREATE POLICY "pay_invoices_update" ON public.pay_invoices
  FOR UPDATE
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()))
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));
-- No DELETE policy → DELETE denied by RLS

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. pay_payments (événement paiement — append-only)
--    Rôle : chaque paiement est un événement immuable.
--    Void logique uniquement (voided_at + void_reason).
--    payment_source : 'manuel' | 'auto'
--    method         : 'virement' | 'prelevement' | 'carte' | 'espece' | 'autre'
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.pay_payments (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id UUID        NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  supplier_id      UUID        NOT NULL REFERENCES public.invoice_suppliers(id) ON DELETE RESTRICT,
  payment_date     DATE        NOT NULL,
  amount_eur       NUMERIC(12,2) NOT NULL,
  method           TEXT        NOT NULL,
  payment_source   TEXT        NOT NULL DEFAULT 'manuel',
  note             TEXT        NULL,
  idempotency_key  UUID        NULL,
  external_ref     TEXT        NULL,
  voided_at        TIMESTAMPTZ NULL,
  void_reason      TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID        NOT NULL
);

CREATE UNIQUE INDEX idx_pay_payments_idempotency
  ON public.pay_payments(establishment_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_pay_payments_est_sup ON public.pay_payments(establishment_id, supplier_id, payment_date);

CREATE OR REPLACE FUNCTION public.fn_pay_payments_validate()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.amount_eur <= 0 THEN
    RAISE EXCEPTION 'pay_payments.amount_eur must be > 0';
  END IF;
  IF NEW.method NOT IN ('virement', 'prelevement', 'carte', 'espece', 'autre') THEN
    RAISE EXCEPTION 'pay_payments.method invalid: must be one of virement, prelevement, carte, espece, autre';
  END IF;
  IF NEW.payment_source NOT IN ('manuel', 'auto') THEN
    RAISE EXCEPTION 'pay_payments.payment_source invalid: must be manuel or auto';
  END IF;
  IF NEW.voided_at IS NOT NULL AND (NEW.void_reason IS NULL OR TRIM(NEW.void_reason) = '') THEN
    RAISE EXCEPTION 'void_reason is required when voiding a payment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pay_payments_validate
  BEFORE INSERT OR UPDATE ON public.pay_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_pay_payments_validate();

-- Enforce append-only: UPDATE restricted to void fields only
CREATE OR REPLACE FUNCTION public.fn_pay_payments_void_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.amount_eur       IS DISTINCT FROM NEW.amount_eur       OR
     OLD.payment_date     IS DISTINCT FROM NEW.payment_date     OR
     OLD.method           IS DISTINCT FROM NEW.method           OR
     OLD.payment_source   IS DISTINCT FROM NEW.payment_source   OR
     OLD.supplier_id      IS DISTINCT FROM NEW.supplier_id      OR
     OLD.establishment_id IS DISTINCT FROM NEW.establishment_id OR
     OLD.organization_id  IS DISTINCT FROM NEW.organization_id  OR
     OLD.note             IS DISTINCT FROM NEW.note             OR
     OLD.external_ref     IS DISTINCT FROM NEW.external_ref     THEN
    RAISE EXCEPTION 'pay_payments is append-only: only voided_at and void_reason can be updated';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pay_payments_void_only
  BEFORE UPDATE ON public.pay_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_pay_payments_void_only();

ALTER TABLE public.pay_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pay_payments_select" ON public.pay_payments
  FOR SELECT USING (establishment_id IN (SELECT public.get_user_establishment_ids()));
CREATE POLICY "pay_payments_insert" ON public.pay_payments
  FOR INSERT WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));
CREATE POLICY "pay_payments_update" ON public.pay_payments
  FOR UPDATE
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()))
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));
-- No DELETE policy → DELETE denied by RLS

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. pay_allocations (répartition paiement → dette)
--    Rôle : lier un paiement à une ou plusieurs dettes.
--    Contrainte : somme allocations par paiement <= payment.amount_eur
--    Interdit d'allouer vers un paiement voidé.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.pay_allocations (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id UUID        NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  payment_id       UUID        NOT NULL REFERENCES public.pay_payments(id) ON DELETE RESTRICT,
  pay_invoice_id   UUID        NOT NULL REFERENCES public.pay_invoices(id) ON DELETE RESTRICT,
  amount_eur       NUMERIC(12,2) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID        NOT NULL
);

CREATE UNIQUE INDEX idx_pay_allocations_uniq ON public.pay_allocations(payment_id, pay_invoice_id);
CREATE INDEX idx_pay_allocations_invoice  ON public.pay_allocations(pay_invoice_id);
CREATE INDEX idx_pay_allocations_payment  ON public.pay_allocations(payment_id);

CREATE OR REPLACE FUNCTION public.fn_pay_allocations_validate()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_payment_amount NUMERIC(12,2);
  v_payment_voided BOOLEAN;
  v_current_total  NUMERIC(12,2);
BEGIN
  IF NEW.amount_eur <= 0 THEN
    RAISE EXCEPTION 'pay_allocations.amount_eur must be > 0';
  END IF;
  SELECT amount_eur, (voided_at IS NOT NULL)
    INTO v_payment_amount, v_payment_voided
    FROM public.pay_payments WHERE id = NEW.payment_id;
  IF v_payment_voided THEN
    RAISE EXCEPTION 'Cannot allocate to a voided payment';
  END IF;
  -- Sum existing allocations (exclude self on UPDATE)
  SELECT COALESCE(SUM(amount_eur), 0)
    INTO v_current_total
    FROM public.pay_allocations
   WHERE payment_id = NEW.payment_id
     AND (TG_OP = 'INSERT' OR id != OLD.id);
  IF v_current_total + NEW.amount_eur > v_payment_amount THEN
    RAISE EXCEPTION 'Total allocations (%) would exceed payment amount (%)',
      v_current_total + NEW.amount_eur, v_payment_amount;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pay_allocations_validate
  BEFORE INSERT OR UPDATE ON public.pay_allocations
  FOR EACH ROW EXECUTE FUNCTION public.fn_pay_allocations_validate();

ALTER TABLE public.pay_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pay_allocations_select" ON public.pay_allocations
  FOR SELECT USING (establishment_id IN (SELECT public.get_user_establishment_ids()));
CREATE POLICY "pay_allocations_insert" ON public.pay_allocations
  FOR INSERT WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));
-- No UPDATE or DELETE policy → both denied by RLS

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. pay_supplier_rules (règles paiement par fournisseur)
--    Rôle : règles structurées machine-readable (1 par fournisseur/établissement).
--    Distinct de invoice_suppliers.payment_terms (texte libre, informatif).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.pay_supplier_rules (
  id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id     UUID        NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  supplier_id          UUID        NOT NULL REFERENCES public.invoice_suppliers(id) ON DELETE CASCADE,
  mode                 TEXT        NOT NULL DEFAULT 'none',
  delay_days           INT         NULL,
  fixed_day_of_month   INT         NULL,
  allow_partial        BOOLEAN     NOT NULL DEFAULT true,
  allocation_strategy  TEXT        NOT NULL DEFAULT 'fifo_oldest',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID        NOT NULL,
  updated_by           UUID        NULL
);

CREATE UNIQUE INDEX idx_pay_supplier_rules_uniq ON public.pay_supplier_rules(establishment_id, supplier_id);

CREATE OR REPLACE FUNCTION public.fn_pay_supplier_rules_validate()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.mode NOT IN ('none', 'manual_transfer', 'direct_debit_delay', 'direct_debit_fixed_day', 'installments') THEN
    RAISE EXCEPTION 'pay_supplier_rules.mode invalid';
  END IF;
  IF NEW.allocation_strategy NOT IN ('fifo_oldest', 'current_month_first', 'manual') THEN
    RAISE EXCEPTION 'pay_supplier_rules.allocation_strategy invalid';
  END IF;
  IF NEW.mode = 'direct_debit_delay' AND NEW.delay_days IS NULL THEN
    RAISE EXCEPTION 'delay_days required when mode = direct_debit_delay';
  END IF;
  IF NEW.mode = 'direct_debit_fixed_day' AND NEW.fixed_day_of_month IS NULL THEN
    RAISE EXCEPTION 'fixed_day_of_month required when mode = direct_debit_fixed_day';
  END IF;
  IF NEW.fixed_day_of_month IS NOT NULL AND (NEW.fixed_day_of_month < 1 OR NEW.fixed_day_of_month > 28) THEN
    RAISE EXCEPTION 'fixed_day_of_month must be between 1 and 28';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pay_supplier_rules_validate
  BEFORE INSERT OR UPDATE ON public.pay_supplier_rules
  FOR EACH ROW EXECUTE FUNCTION public.fn_pay_supplier_rules_validate();

ALTER TABLE public.pay_supplier_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pay_supplier_rules_select" ON public.pay_supplier_rules
  FOR SELECT USING (establishment_id IN (SELECT public.get_user_establishment_ids()));
CREATE POLICY "pay_supplier_rules_insert" ON public.pay_supplier_rules
  FOR INSERT WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));
CREATE POLICY "pay_supplier_rules_update" ON public.pay_supplier_rules
  FOR UPDATE
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()))
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));
-- No DELETE policy → denied

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. pay_schedule_items (échéanciers attendus — future-proof)
--    Rôle : afficher échéances sans créer de vrai paiement.
--    Void logique uniquement. UPDATE restreint aux champs void.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.pay_schedule_items (
  id                  UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id    UUID          NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  supplier_id         UUID          NOT NULL REFERENCES public.invoice_suppliers(id) ON DELETE RESTRICT,
  pay_invoice_id      UUID          NULL REFERENCES public.pay_invoices(id) ON DELETE SET NULL,
  due_date            DATE          NOT NULL,
  expected_amount_eur NUMERIC(12,2) NULL,
  source              TEXT          NOT NULL DEFAULT 'manuel',
  voided_at           TIMESTAMPTZ   NULL,
  void_reason         TEXT          NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by          UUID          NOT NULL
);

CREATE INDEX idx_pay_schedule_sup_date ON public.pay_schedule_items(supplier_id, due_date);
CREATE INDEX idx_pay_schedule_est_date ON public.pay_schedule_items(establishment_id, due_date);

CREATE OR REPLACE FUNCTION public.fn_pay_schedule_items_validate()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.source NOT IN ('manuel', 'rule') THEN
    RAISE EXCEPTION 'pay_schedule_items.source must be manuel or rule';
  END IF;
  IF NEW.voided_at IS NOT NULL AND (NEW.void_reason IS NULL OR TRIM(NEW.void_reason) = '') THEN
    RAISE EXCEPTION 'void_reason is required when voiding a schedule item';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.supplier_id         IS DISTINCT FROM NEW.supplier_id         OR
       OLD.establishment_id    IS DISTINCT FROM NEW.establishment_id    OR
       OLD.due_date            IS DISTINCT FROM NEW.due_date            OR
       OLD.expected_amount_eur IS DISTINCT FROM NEW.expected_amount_eur OR
       OLD.source              IS DISTINCT FROM NEW.source              OR
       OLD.pay_invoice_id      IS DISTINCT FROM NEW.pay_invoice_id      THEN
      RAISE EXCEPTION 'pay_schedule_items is append-only: only voided_at and void_reason can be updated';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pay_schedule_items_validate
  BEFORE INSERT OR UPDATE ON public.pay_schedule_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_pay_schedule_items_validate();

ALTER TABLE public.pay_schedule_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pay_schedule_items_select" ON public.pay_schedule_items
  FOR SELECT USING (establishment_id IN (SELECT public.get_user_establishment_ids()));
CREATE POLICY "pay_schedule_items_insert" ON public.pay_schedule_items
  FOR INSERT WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));
CREATE POLICY "pay_schedule_items_update" ON public.pay_schedule_items
  FOR UPDATE
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()))
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));
-- No DELETE policy → denied
