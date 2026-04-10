
-- ============================================================
-- ÉTAPE 4: DRAFT TTL Cron — Abandon stale DRAFTs after 1 hour
-- ============================================================

-- 1. Create the RPC function that the cron job will call
CREATE OR REPLACE FUNCTION public.fn_abandon_stale_drafts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE stock_documents
  SET status = 'ABANDONED',
      updated_at = now()
  WHERE status = 'DRAFT'
    AND created_at < now() - interval '1 hour';
  
  GET DIAGNOSTICS affected = ROW_COUNT;
  
  -- Log for observability
  IF affected > 0 THEN
    RAISE LOG '[draft-ttl-cron] Abandoned % stale DRAFT(s)', affected;
  END IF;
  
  RETURN affected;
END;
$$;

-- 2. Schedule the cron job (every hour at minute 30)
SELECT cron.schedule(
  'abandon-stale-drafts-hourly',
  '30 * * * *',
  $$SELECT public.fn_abandon_stale_drafts()$$
);
