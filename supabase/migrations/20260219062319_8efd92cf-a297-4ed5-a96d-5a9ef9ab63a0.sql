
-- Table pay_establishment_settings
-- Paramètres de paiement par établissement (SSOT, pas de logique dans pay_supplier_rules)
CREATE TABLE IF NOT EXISTS public.pay_establishment_settings (
  establishment_id UUID PRIMARY KEY REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  auto_record_direct_debit BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID,
  updated_by  UUID
);

-- Trigger updated_at
CREATE TRIGGER trg_pay_establishment_settings_updated_at
  BEFORE UPDATE ON public.pay_establishment_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.pay_establishment_settings ENABLE ROW LEVEL SECURITY;

-- SELECT : membres de l'établissement
CREATE POLICY "pay_estab_settings_select"
  ON public.pay_establishment_settings
  FOR SELECT
  TO authenticated
  USING (
    establishment_id IN (
      SELECT establishment_id FROM public.user_establishments WHERE user_id = auth.uid()
    )
    OR public.is_admin(auth.uid())
  );

-- INSERT : admin ou membre write (has_module_access)
CREATE POLICY "pay_estab_settings_insert"
  ON public.pay_establishment_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_module_access('paiements', 'write', establishment_id)
    OR public.is_admin(auth.uid())
  );

-- UPDATE : admin ou membre write
CREATE POLICY "pay_estab_settings_update"
  ON public.pay_establishment_settings
  FOR UPDATE
  TO authenticated
  USING (
    public.has_module_access('paiements', 'write', establishment_id)
    OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    public.has_module_access('paiements', 'write', establishment_id)
    OR public.is_admin(auth.uid())
  );

-- DELETE interdit : aucune policy DELETE → bloqué par RLS
