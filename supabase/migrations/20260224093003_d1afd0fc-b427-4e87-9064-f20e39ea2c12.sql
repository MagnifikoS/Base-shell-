
-- ══════════════════════════════════════════════════════════════
-- P0: PLATFORM ADMINS — Table + Function (100% additive)
-- ══════════════════════════════════════════════════════════════

-- 1. Table platform_admins (independent from roles/organizations)
CREATE TABLE public.platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 2. Enable RLS — ultra restrictive
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- 3. RLS: Only platform admins can SELECT (no INSERT/UPDATE/DELETE from client)
CREATE POLICY "platform_admins_select_self"
  ON public.platform_admins
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies = impossible to self-promote from client

-- 4. Function is_platform_admin() — independent, SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id UUID)
  RETURNS BOOLEAN
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = _user_id
  );
$$;
