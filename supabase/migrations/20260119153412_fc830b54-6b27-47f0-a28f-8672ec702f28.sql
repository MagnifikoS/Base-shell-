-- Allow employees to view their own leaves (SELECT only)
CREATE POLICY "Employees can view their own leaves"
ON public.personnel_leaves
FOR SELECT
USING (user_id = auth.uid());