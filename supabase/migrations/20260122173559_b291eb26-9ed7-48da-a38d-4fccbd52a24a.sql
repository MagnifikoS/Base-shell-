-- Revert: Make team_id required again in invitations table
ALTER TABLE public.invitations ALTER COLUMN team_id SET NOT NULL;