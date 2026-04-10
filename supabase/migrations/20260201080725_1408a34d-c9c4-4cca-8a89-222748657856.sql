-- Allow admins to update establishments
CREATE POLICY "Admins can update establishments"
ON public.establishments
FOR UPDATE
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));