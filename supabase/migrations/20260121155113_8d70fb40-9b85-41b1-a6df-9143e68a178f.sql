-- Add unique constraint to prevent duplicate role assignments
ALTER TABLE public.user_roles 
ADD CONSTRAINT user_roles_user_id_role_id_key UNIQUE (user_id, role_id);