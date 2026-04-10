-- Add trade_name and contact_email to establishments table
-- address already exists, will be reused

ALTER TABLE public.establishments
ADD COLUMN IF NOT EXISTS trade_name TEXT NULL;

ALTER TABLE public.establishments
ADD COLUMN IF NOT EXISTS contact_email TEXT NULL;

COMMENT ON COLUMN public.establishments.trade_name IS 'Nom commercial de l établissement (différent du nom légal)';
COMMENT ON COLUMN public.establishments.contact_email IS 'Email de contact de l établissement';