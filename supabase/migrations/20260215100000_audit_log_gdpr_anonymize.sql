-- ═══════════════════════════════════════════════════════════════════════════
-- GDPR Anonymization Escape Hatch for Audit Logs
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The previous migration (20260215000003) blocks ALL updates on audit_logs.
-- However, GDPR requires the ability to anonymize personal data in logs
-- when a user exercises their "right to erasure" (Article 17).
--
-- This migration replaces the blanket update block with a more nuanced one:
-- - ONLY the `metadata` field can be updated (for anonymization)
-- - The update must set metadata to contain `"anonymized": true`
-- - All other columns remain immutable
-- - Normal users still cannot update (REVOKE remains)
--
-- Usage (from data-retention-cleanup or DSAR export):
--   UPDATE audit_logs
--   SET metadata = jsonb_build_object('anonymized', true, 'reason', 'GDPR erasure')
--   WHERE user_id = '<user-to-anonymize>';
-- ═══════════════════════════════════════════════════════════════════════════

-- Replace the blanket update blocker with a GDPR-aware version
CREATE OR REPLACE FUNCTION public.prevent_audit_log_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow metadata-only updates for GDPR anonymization
  -- All other columns must remain unchanged
  IF NEW.id = OLD.id
     AND NEW.organization_id = OLD.organization_id
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.action = OLD.action
     AND NEW.target_type = OLD.target_type
     AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
     AND NEW.created_at = OLD.created_at
     AND (NEW.ip_address IS NOT DISTINCT FROM OLD.ip_address)
     AND (NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent)
     AND NEW.metadata IS DISTINCT FROM OLD.metadata
     AND (NEW.metadata->>'anonymized')::boolean = true
  THEN
    -- This is a legitimate GDPR anonymization update
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Audit log entries can only be updated for GDPR anonymization (metadata.anonymized = true)';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.prevent_audit_log_update() IS
  'DATA-01: Prevents modification of audit log entries except for GDPR anonymization. '
  'Only the metadata field can be updated, and only when setting anonymized=true.';
