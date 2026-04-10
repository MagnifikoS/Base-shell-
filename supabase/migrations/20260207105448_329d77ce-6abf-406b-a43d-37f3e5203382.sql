-- ═══════════════════════════════════════════════════════════════════════════
-- MODÈLE B: Ajout champ SSOT "supplier_billing_unit"
-- ═══════════════════════════════════════════════════════════════════════════
-- Ce champ représente l'unité dans laquelle le fournisseur exprime la quantité
-- sur ses factures pour ce produit (ex: kg, g, L, ml, pce, Carton, etc.)
-- C'est la SOURCE DE VÉRITÉ unique pour interpréter les quantités facturées.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.products_v2
ADD COLUMN IF NOT EXISTS supplier_billing_unit text DEFAULT NULL;

-- Commentaire pour documentation
COMMENT ON COLUMN public.products_v2.supplier_billing_unit IS 
  'Unité de facturation fournisseur (SSOT). Valeurs attendues: kg, g, L, ml, pce, ou label packaging (Carton, Caisse, etc.). Source unique pour interpréter la quantité sur les factures de ce fournisseur.';