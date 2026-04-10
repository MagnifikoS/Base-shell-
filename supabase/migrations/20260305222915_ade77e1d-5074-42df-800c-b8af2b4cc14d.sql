
-- Table SSOT pour stocker les DLC par lot réceptionné (V0 : 1 DLC par ligne)
CREATE TABLE public.reception_lot_dlc (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_line_id    uuid NOT NULL UNIQUE REFERENCES public.commande_lines(id) ON DELETE CASCADE,
  establishment_id    uuid NOT NULL REFERENCES public.establishments(id),
  product_id          uuid NOT NULL REFERENCES public.products_v2(id),
  dlc_date            date NOT NULL,
  quantity_received   numeric NOT NULL,
  canonical_unit_id   uuid NOT NULL REFERENCES public.measurement_units(id),
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX idx_reception_lot_dlc_est_dlc ON public.reception_lot_dlc(establishment_id, dlc_date);
CREATE INDEX idx_reception_lot_dlc_line ON public.reception_lot_dlc(commande_line_id);

ALTER TABLE public.reception_lot_dlc ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dlc_select_own_est" ON public.reception_lot_dlc
  FOR SELECT TO authenticated
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "dlc_insert_own_est" ON public.reception_lot_dlc
  FOR INSERT TO authenticated
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "dlc_update_own_est" ON public.reception_lot_dlc
  FOR UPDATE TO authenticated
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- Paramètre seuil alerte DLC par produit (optionnel, fallback 3 jours)
ALTER TABLE public.products_v2 ADD COLUMN IF NOT EXISTS dlc_warning_days integer DEFAULT NULL;
