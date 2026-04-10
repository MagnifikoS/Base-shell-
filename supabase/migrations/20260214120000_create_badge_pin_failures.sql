-- SEC-02: Create badge_pin_failures table for PIN rate limiting
-- Tracks failed PIN attempts to enforce lockout after 5 failures in 15 minutes

CREATE TABLE IF NOT EXISTS public.badge_pin_failures (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient lookups: user + establishment + time window
CREATE INDEX IF NOT EXISTS idx_badge_pin_failures_lookup
  ON public.badge_pin_failures (user_id, establishment_id, attempted_at DESC);

-- RLS: Only service role (edge functions) should access this table
ALTER TABLE public.badge_pin_failures ENABLE ROW LEVEL SECURITY;

-- Auto-cleanup: delete records older than 1 hour (generous window beyond 15min lockout)
-- This can be run periodically via a cron job or pg_cron extension
COMMENT ON TABLE public.badge_pin_failures IS 'SEC-02: Tracks failed PIN attempts for rate limiting. Records older than 15 minutes are ignored by the application. Periodic cleanup recommended.';
