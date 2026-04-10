
-- Fix: policy price_alerts_select was created on wrong table
DROP POLICY IF EXISTS "price_alerts_select" ON public.price_alert_settings;

CREATE POLICY "price_alerts_select"
  ON public.price_alerts FOR SELECT TO authenticated
  USING (establishment_id IN (SELECT get_user_establishment_ids()));
