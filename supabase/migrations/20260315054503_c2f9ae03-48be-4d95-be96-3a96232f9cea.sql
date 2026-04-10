ALTER TABLE public.products_v2
  ADD COLUMN IF NOT EXISTS withdrawal_unit_id uuid REFERENCES public.measurement_units(id) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS withdrawal_steps jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS withdrawal_default_step numeric DEFAULT NULL;

COMMENT ON COLUMN public.products_v2.withdrawal_unit_id IS 'Unité retrait — unité dans laquelle les salariés retirent réellement le produit (ex: boîte, sac, bidon). FK vers measurement_units.';
COMMENT ON COLUMN public.products_v2.withdrawal_steps IS 'Pas retrait — incréments proposés en chips dans le popup retrait (ex: [0.25, 0.5, 1]). JSONB array of numbers.';
COMMENT ON COLUMN public.products_v2.withdrawal_default_step IS 'Pas par défaut suggéré à ouverture du popup retrait.';