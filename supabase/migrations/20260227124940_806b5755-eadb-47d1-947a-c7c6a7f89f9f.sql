-- ÉTAPE 3 Migration 4/5: B2B invoice sequence
-- SCOPE: invoice-only. No changes to products/stock/inventory.
-- ROLLBACK: DROP SEQUENCE IF EXISTS public.b2b_invoice_seq;

CREATE SEQUENCE IF NOT EXISTS public.b2b_invoice_seq
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;