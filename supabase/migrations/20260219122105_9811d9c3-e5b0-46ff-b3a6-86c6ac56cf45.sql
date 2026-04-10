
-- Ajout d'un indicateur d'affichage UI uniquement
-- Ce booléen indique si le paiement fournisseur est traité en "agrégat mensuel"
-- (1 seul paiement pour tout le mois) vs "par facture" (1 paiement par facture).
-- Il n'affecte PAS la logique de paiement ni les calculs du moteur.
ALTER TABLE public.pay_supplier_rules
  ADD COLUMN IF NOT EXISTS is_monthly_aggregate BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pay_supplier_rules.is_monthly_aggregate IS
  'UI uniquement : si true, le cockpit À payer masque les actions par facture et affiche un récap mensuel global. Ne modifie aucun calcul ni chemin de paiement.';
