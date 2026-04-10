-- Create invitation status enum
CREATE TYPE public.invitation_status AS ENUM ('invited', 'requested', 'accepted', 'rejected', 'canceled', 'expired');

-- Create invitations table
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE RESTRICT,
  status public.invitation_status NOT NULL DEFAULT 'invited',
  expires_at timestamp with time zone NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Unique constraint: one active invitation per email per org
CREATE UNIQUE INDEX invitations_unique_active_email 
ON public.invitations (organization_id, email) 
WHERE status IN ('invited', 'requested');

-- Enable RLS
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- SELECT policy: only admins can view invitations
CREATE POLICY "Admins can view org invitations"
ON public.invitations
FOR SELECT
USING (
  organization_id = public.get_user_organization_id() 
  AND public.is_admin(auth.uid())
);

-- Trigger for updated_at
CREATE TRIGGER update_invitations_updated_at
BEFORE UPDATE ON public.invitations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add Invitations module to modules table
INSERT INTO public.modules (key, name, display_order) VALUES
  ('invitations', 'Invitations', 12)
ON CONFLICT (key) DO NOTHING;

-- Create audit_logs table for tracking actions
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  metadata jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on audit_logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs
CREATE POLICY "Admins can view org audit logs"
ON public.audit_logs
FOR SELECT
USING (
  organization_id = public.get_user_organization_id() 
  AND public.is_admin(auth.uid())
);