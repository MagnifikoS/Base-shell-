-- Make team_id optional in invitations table
ALTER TABLE public.invitations ALTER COLUMN team_id DROP NOT NULL;