-- ÉTAPE 3 Migration 1/5: Add nullable finance columns to invoices
-- SCOPE: invoice-only. No changes to products/stock/inventory.
-- ROLLBACK: ALTER TABLE public.invoices DROP COLUMN IF EXISTS amount_ht, DROP COLUMN IF EXISTS vat_rate, DROP COLUMN IF EXISTS vat_amount;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS amount_ht numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS vat_rate numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS vat_amount numeric DEFAULT NULL;

COMMENT ON COLUMN public.invoices.amount_ht IS 'Montant HT (nullable, pas de backfill)';
COMMENT ON COLUMN public.invoices.vat_rate IS 'Taux TVA en % (nullable = TVA non renseignée)';
COMMENT ON COLUMN public.invoices.vat_amount IS 'Montant TVA en EUR (nullable)';