-- ═══════════════════════════════════════════════════════════════════════════
-- DB-CRON-001: Automated weekly scheduler for data-retention-cleanup
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This migration sets up pg_cron to automatically invoke the
-- data-retention-cleanup edge function every Sunday at 03:00 UTC.
--
-- Prerequisites:
--   - pg_cron extension must be enabled in Supabase dashboard
--   - pg_net extension for HTTP calls
--
-- IMPORTANT: pg_cron is available on Supabase Pro plans and above.
-- On free tier, this migration succeeds as a no-op.
-- ═══════════════════════════════════════════════════════════════════════════

DO $outer$
BEGIN
  -- Check if pg_cron extension is available
  IF NOT EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron'
  ) THEN
    RAISE NOTICE 'DB-CRON-001: pg_cron not available. Schedule data-retention-cleanup externally.';
    RETURN;
  END IF;

  -- Enable extensions
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

  -- Remove existing job if present (idempotent)
  PERFORM cron.unschedule('data-retention-weekly-cleanup')
  FROM cron.job WHERE jobname = 'data-retention-weekly-cleanup';

  -- Schedule weekly cleanup: every Sunday at 03:00 UTC
  PERFORM cron.schedule(
    'data-retention-weekly-cleanup',
    '0 3 * * 0',
    $cron$
    SELECT net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/data-retention-cleanup',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{"dry_run": false}'::jsonb
    );
    $cron$
  );

  RAISE NOTICE 'DB-CRON-001: pg_cron job scheduled (Sunday 03:00 UTC)';

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'DB-CRON-001: Could not configure pg_cron (%). Skipping.', SQLERRM;
END
$outer$;

COMMENT ON SCHEMA public IS
  'DB-CRON-001: data-retention-cleanup is scheduled weekly via pg_cron (if available). '
  'See supabase/functions/data-retention-cleanup/index.ts for cleanup logic.';
