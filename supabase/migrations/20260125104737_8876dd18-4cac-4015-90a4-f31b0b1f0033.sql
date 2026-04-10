-- ÉTAPE 43bis — Enable multi-invitation per establishment
-- SAFE DB migration — structure only, no data rewrite

-- Drop old restrictive index (1 active invite per email per org)
DROP INDEX IF EXISTS invitations_unique_active_email;

-- Create new scoped index:
-- 1 active invitation per email PER establishment
CREATE UNIQUE INDEX invitations_unique_active_email
ON public.invitations (organization_id, email, establishment_id)
WHERE status IN ('invited', 'requested');