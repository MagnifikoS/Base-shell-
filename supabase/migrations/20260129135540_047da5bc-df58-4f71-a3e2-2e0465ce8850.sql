-- Phase 1: Add Navigo pass fields to employee_details
-- SSOT: employee_details table (same as all other employee info fields)

ALTER TABLE public.employee_details
ADD COLUMN has_navigo_pass BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN navigo_pass_number TEXT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.employee_details.has_navigo_pass IS 'Whether employee has a Navigo pass';
COMMENT ON COLUMN public.employee_details.navigo_pass_number IS 'Navigo pass number (optional, nullable if has_navigo_pass is false)';