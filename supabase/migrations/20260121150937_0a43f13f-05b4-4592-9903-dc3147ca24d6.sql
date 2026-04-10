-- Hotfix: Add WITH CHECK to UPDATE policy for proper security
-- This ensures caisse_day users can only UPDATE the business day, not just SELECT it

DROP POLICY IF EXISTS "Users can update cash reports with proper permissions" ON public.cash_day_reports;

CREATE POLICY "Users can update cash reports with proper permissions" 
ON public.cash_day_reports 
FOR UPDATE 
USING (
  is_admin(auth.uid()) OR (
    (establishment_id IN (SELECT get_user_establishment_ids()))
    AND can_write_cash(auth.uid())
    AND (
      has_cash_permission(auth.uid(), 'caisse_month'::permission_scope)
      OR (has_cash_permission(auth.uid(), 'caisse_day'::permission_scope) AND (day_date = get_business_day(now())))
    )
  )
)
WITH CHECK (
  is_admin(auth.uid()) OR (
    (establishment_id IN (SELECT get_user_establishment_ids()))
    AND can_write_cash(auth.uid())
    AND (
      has_cash_permission(auth.uid(), 'caisse_month'::permission_scope)
      OR (has_cash_permission(auth.uid(), 'caisse_day'::permission_scope) AND (day_date = get_business_day(now())))
    )
  )
);