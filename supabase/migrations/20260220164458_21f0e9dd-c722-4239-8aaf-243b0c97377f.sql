-- Add read_at column to notification_events
ALTER TABLE public.notification_events ADD COLUMN read_at timestamptz DEFAULT NULL;

-- Allow users to update their own notification read status
CREATE POLICY "Users can mark own notifications as read"
ON public.notification_events
FOR UPDATE
USING (auth.uid() = recipient_user_id)
WITH CHECK (auth.uid() = recipient_user_id);
