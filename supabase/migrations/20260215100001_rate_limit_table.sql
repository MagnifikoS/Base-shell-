-- ═══════════════════════════════════════════════════════════════════════════
-- DB-Backed Rate Limiting Table
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Used by supabase/functions/_shared/rateLimit.ts for persistent rate
-- limiting across Edge Function cold starts.
--
-- Entries are ephemeral — auto-cleaned after 10 minutes via a cron-safe
-- approach (the rate limiter only queries entries within the window).
-- A periodic cleanup can be added via pg_cron if table grows too large.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.rate_limit_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups by key + time window
CREATE INDEX IF NOT EXISTS idx_rate_limit_key_created
  ON public.rate_limit_entries (key, created_at DESC);

-- Auto-cleanup: delete entries older than 10 minutes
-- This keeps the table small without needing pg_cron
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_entries()
RETURNS TRIGGER AS $$
BEGIN
  -- On every INSERT, delete entries older than 10 minutes
  -- Uses a probabilistic approach: only clean 1% of the time to avoid overhead
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_entries
    WHERE created_at < now() - interval '10 minutes';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rate_limit_cleanup ON public.rate_limit_entries;

CREATE TRIGGER rate_limit_cleanup
  AFTER INSERT ON public.rate_limit_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_rate_limit_entries();

-- RLS: No user access needed — only service role writes/reads
ALTER TABLE public.rate_limit_entries ENABLE ROW LEVEL SECURITY;

-- No policies = no user access (service role bypasses RLS)

COMMENT ON TABLE public.rate_limit_entries IS
  'Ephemeral rate limiting entries. Auto-cleaned. Used by Edge Function rate limiter.';
