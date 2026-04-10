-- Allow admins to view user_establishments for their assigned establishments
-- This enables the Payroll module to fetch all employees for an establishment

CREATE POLICY "Admins can view org user establishments"
ON public.user_establishments
FOR SELECT
USING (
  is_admin(auth.uid()) AND 
  establishment_id IN (SELECT get_user_establishment_ids())
);