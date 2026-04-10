-- Create user status enum
CREATE TYPE public.user_status AS ENUM ('invited', 'requested', 'active', 'disabled', 'rejected');

-- Add status column to profiles
ALTER TABLE public.profiles 
ADD COLUMN status public.user_status NOT NULL DEFAULT 'active';

-- Update existing profiles to 'active' (they are bootstrap admins)
UPDATE public.profiles SET status = 'active' WHERE status IS NULL OR status = 'active';

-- Add Users module to modules table
INSERT INTO public.modules (key, name, display_order) VALUES
  ('users', 'Utilisateurs', 8)
ON CONFLICT (key) DO NOTHING;

-- Create user_teams table for team assignments
CREATE TABLE public.user_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, team_id)
);

-- Enable RLS on user_teams
ALTER TABLE public.user_teams ENABLE ROW LEVEL SECURITY;

-- Users can view their own team assignments
CREATE POLICY "Users can view own team assignments"
ON public.user_teams
FOR SELECT
USING (user_id = auth.uid());

-- Admins can view all team assignments in org
CREATE POLICY "Admins can view org team assignments"
ON public.user_teams
FOR SELECT
USING (
  public.is_admin(auth.uid()) AND
  team_id IN (
    SELECT id FROM public.teams 
    WHERE organization_id = public.get_user_organization_id()
  )
);