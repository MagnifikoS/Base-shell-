-- Allow users to read their own notification events
DROP POLICY IF EXISTS "Users with module access can read notification_events" ON public.notification_events;

CREATE POLICY "Users can read their own notification_events"
ON public.notification_events
FOR SELECT
USING (recipient_user_id = auth.uid());

-- Also allow admins/managers with alertes module access to read all
CREATE POLICY "Module access can read all notification_events"
ON public.notification_events
FOR SELECT
USING (public.has_module_access('alertes'::text, 'read'::access_level, establishment_id));
