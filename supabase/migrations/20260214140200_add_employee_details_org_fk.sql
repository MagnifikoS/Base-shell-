-- DB-03: Add foreign key from employee_details.organization_id to organizations.id
--
-- The employee_details table has organization_id UUID NOT NULL but lacks a FK constraint.
-- This creates a referential integrity gap: rows could reference non-existent organizations.
--
-- Fix: Add FK with ON DELETE CASCADE so that if an organization is deleted,
-- all associated employee_details are cleaned up automatically.
--
-- Idempotent: Uses DO $$ block with IF NOT EXISTS check.

DO $$
BEGIN
  -- Only add the FK if it does not already exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'employee_details_organization_id_fkey'
      AND table_name = 'employee_details'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.employee_details
    ADD CONSTRAINT employee_details_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE;
  END IF;
END $$;

-- Also add FK for user_id → auth.users if not present
-- (user_id is NOT NULL UNIQUE but may lack FK)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'employee_details_user_id_fkey'
      AND table_name = 'employee_details'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.employee_details
    ADD CONSTRAINT employee_details_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE;
  END IF;
END $$;
