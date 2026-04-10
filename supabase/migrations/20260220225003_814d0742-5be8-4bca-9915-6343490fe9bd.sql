
-- ═══════════════════════════════════════════════════════════════════════════
-- Step 2: Delivery observability — notification_delivery_logs
-- Tracks per-device delivery attempts for every notification_event
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.notification_delivery_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  notification_event_id UUID REFERENCES public.notification_events(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  recipient_user_id UUID NOT NULL,
  alert_key TEXT NOT NULL,
  
  -- Device info (NULL when status = no_subscription)
  push_subscription_id UUID,
  endpoint_domain TEXT,
  
  -- Delivery result
  status TEXT NOT NULL CHECK (status IN ('delivered', 'failed', 'expired', 'no_subscription')),
  http_status INTEGER,
  error_message TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying by event
CREATE INDEX idx_delivery_logs_event ON public.notification_delivery_logs(notification_event_id);
-- Index for querying by user (debug: "why doesn't user X receive?")
CREATE INDEX idx_delivery_logs_user ON public.notification_delivery_logs(recipient_user_id, created_at DESC);
-- Index for querying by establishment
CREATE INDEX idx_delivery_logs_est ON public.notification_delivery_logs(establishment_id, created_at DESC);
-- Index for finding expired/failed (cleanup & diagnostics)
CREATE INDEX idx_delivery_logs_status ON public.notification_delivery_logs(status) WHERE status != 'delivered';

-- Enable RLS
ALTER TABLE public.notification_delivery_logs ENABLE ROW LEVEL SECURITY;

-- Admins in the same org can read delivery logs
CREATE POLICY "Admins can read delivery logs"
  ON public.notification_delivery_logs
  FOR SELECT
  USING (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue WHERE ue.user_id = auth.uid()
    )
  );

-- Users can see their own delivery logs
CREATE POLICY "Users can read own delivery logs"
  ON public.notification_delivery_logs
  FOR SELECT
  USING (recipient_user_id = auth.uid());

-- No INSERT/UPDATE/DELETE from client — only edge functions (service role) write
-- Service role bypasses RLS

-- Auto-cleanup: keep 30 days of delivery logs (optional cron later)
COMMENT ON TABLE public.notification_delivery_logs IS 'Per-device delivery trace for push notifications. Written by notif-check-badgeuse edge function. Retention: 30 days recommended.';
