
-- ═══════════════════════════════════════════════════════════════════════════
-- PATCH PRÉ-PHASE 3 : idempotency_key UUID → TEXT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- BUG : generateDueAutoPayments insère "auto-<invoiceId>-<dueDate>" (text)
--       mais la colonne est de type UUID → INSERT échoue silencieusement.
--
-- FIX : élargir en TEXT. L'index unique (establishment_id, idempotency_key)
--       fonctionne identiquement sur TEXT. Aucune donnée existante à migrer
--       (table vide en test, 0 rows confirmé).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Drop l'index unique (dépend du type — doit être recréé après ALTER)
DROP INDEX IF EXISTS idx_pay_payments_idempotency;

-- 2. Changer le type UUID → TEXT
ALTER TABLE public.pay_payments
  ALTER COLUMN idempotency_key TYPE TEXT USING idempotency_key::TEXT;

-- 3. Recréer l'index unique (identique, mais sur TEXT maintenant)
CREATE UNIQUE INDEX idx_pay_payments_idempotency
  ON public.pay_payments (establishment_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
