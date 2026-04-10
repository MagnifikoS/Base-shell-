
-- Ajouter commande_plat_id nullable sur app_invoices
ALTER TABLE public.app_invoices
  ADD COLUMN commande_plat_id uuid REFERENCES public.commande_plats(id) DEFAULT NULL;
