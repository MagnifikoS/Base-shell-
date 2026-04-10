
-- ═══════════════════════════════════════════════════════════════════════════
-- Phase A+B: Create establishment_role_nav_config (per-role nav visibility)
-- ═══════════════════════════════════════════════════════════════════════════

-- B1: New table with composite PK (establishment_id, role_id)
CREATE TABLE public.establishment_role_nav_config (
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  hidden_ids text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  PRIMARY KEY (establishment_id, role_id)
);

-- B2: RLS — same pattern as establishment_nav_config
ALTER TABLE public.establishment_role_nav_config ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user in the establishment
CREATE POLICY "Users can read nav config for their establishments"
  ON public.establishment_role_nav_config
  FOR SELECT
  TO authenticated
  USING (
    establishment_id IN (SELECT public.get_user_establishment_ids())
  );

-- Write: admin/directeur/super admin only
CREATE POLICY "Admins can write nav config"
  ON public.establishment_role_nav_config
  FOR ALL
  TO authenticated
  USING (
    establishment_id IN (SELECT public.get_user_establishment_ids())
    AND (
      public.is_admin(auth.uid())
      OR public.has_role(auth.uid(), 'Directeur')
      OR public.has_role(auth.uid(), 'Super Admin')
    )
  )
  WITH CHECK (
    establishment_id IN (SELECT public.get_user_establishment_ids())
    AND (
      public.is_admin(auth.uid())
      OR public.has_role(auth.uid(), 'Directeur')
      OR public.has_role(auth.uid(), 'Super Admin')
    )
  );

-- B3: Migrate existing data from legacy table
-- For each establishment config, copy hidden_ids to ALL roles linked to that establishment
INSERT INTO public.establishment_role_nav_config (establishment_id, role_id, hidden_ids, updated_at, updated_by)
SELECT
  enc.establishment_id,
  ur_roles.role_id,
  enc.hidden_ids,
  enc.updated_at,
  enc.updated_by
FROM public.establishment_nav_config enc
CROSS JOIN LATERAL (
  SELECT DISTINCT ur.role_id
  FROM public.user_roles ur
  WHERE ur.establishment_id = enc.establishment_id
) ur_roles
ON CONFLICT (establishment_id, role_id) DO NOTHING;
