-- DATA-01: Add immutability protection to audit_logs
--
-- Audit log entries must be tamper-proof. This migration:
-- 1. Revokes UPDATE and DELETE from the authenticated role
-- 2. Adds a trigger to prevent all UPDATEs (even by service role)
-- 3. Adds a trigger to prevent DELETEs of recent records (< 2 years old),
--    while still allowing GDPR-mandated data retention cleanup of older records
--
-- The 2-year retention threshold matches the policy in data-retention-cleanup
-- edge function (see supabase/functions/data-retention-cleanup/index.ts).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Revoke UPDATE and DELETE from authenticated role
--    Normal users should never modify audit logs, even via RLS bypass
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE UPDATE, DELETE ON public.audit_logs FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Trigger: prevent ALL updates to audit log entries
--    No legitimate reason to update an audit log entry
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prevent_audit_log_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log entries cannot be modified';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists to make migration idempotent
DROP TRIGGER IF EXISTS audit_log_no_update ON public.audit_logs;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_log_update();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Trigger: prevent DELETE of recent audit log entries
--    Only allows deletion of records older than 2 years (GDPR retention)
--    This permits the data-retention-cleanup edge function to purge old records
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prevent_audit_log_recent_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.created_at > (now() - interval '2 years') THEN
    RAISE EXCEPTION 'Audit log entries less than 2 years old cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists to make migration idempotent
DROP TRIGGER IF EXISTS audit_log_no_recent_delete ON public.audit_logs;

CREATE TRIGGER audit_log_no_recent_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_log_recent_delete();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Documentation
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON FUNCTION public.prevent_audit_log_update() IS
  'DATA-01: Prevents any modification of audit log entries for tamper-proofing.';

COMMENT ON FUNCTION public.prevent_audit_log_recent_delete() IS
  'DATA-01: Prevents deletion of audit log entries less than 2 years old. '
  'Allows GDPR-mandated cleanup of older records by data-retention-cleanup function.';
