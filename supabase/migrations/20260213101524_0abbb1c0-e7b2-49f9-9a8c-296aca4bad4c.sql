
-- Table de configuration navigation mobile par établissement
-- Remplace le localStorage (per-user) par une config partagée (per-establishment)
CREATE TABLE public.establishment_nav_config (
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  hidden_ids TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  PRIMARY KEY (establishment_id)
);

-- Enable RLS
ALTER TABLE public.establishment_nav_config ENABLE ROW LEVEL SECURITY;

-- Lecture: tout utilisateur authentifié lié à l'organisation peut lire
CREATE POLICY "Users can read nav config for their establishment"
  ON public.establishment_nav_config
  FOR SELECT
  TO authenticated
  USING (
    establishment_id IN (
      SELECT ur.establishment_id FROM public.user_roles ur WHERE ur.user_id = auth.uid()
    )
  );

-- Écriture: seuls les admins (via is_admin check)
CREATE POLICY "Admins can upsert nav config"
  ON public.establishment_nav_config
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND ur.establishment_id = establishment_nav_config.establishment_id
        AND r.name IN ('Administrateur', 'Super Admin', 'Directeur')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND ur.establishment_id = establishment_nav_config.establishment_id
        AND r.name IN ('Administrateur', 'Super Admin', 'Directeur')
    )
  );
