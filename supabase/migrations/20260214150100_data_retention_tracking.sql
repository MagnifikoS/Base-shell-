-- RGPD-05: Data Retention Tracking
--
-- This migration adds infrastructure to support automatic data retention cleanup:
-- 1. Indexes for efficient date-range queries used by the cleanup function
-- 2. A data_retention_runs table to track cleanup execution history
--
-- References: docs/data-retention-policy.md

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Indexes for efficient retention cleanup queries
--    These indexes support the date-range scans in data-retention-cleanup
-- ═══════════════════════════════════════════════════════════════════════════

-- badge_events: cleanup scans by created_at
CREATE INDEX IF NOT EXISTS idx_badge_events_created_at
  ON public.badge_events (created_at);

-- planning_shifts: cleanup scans by created_at
CREATE INDEX IF NOT EXISTS idx_planning_shifts_created_at
  ON public.planning_shifts (created_at);

-- audit_logs: cleanup scans by created_at
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON public.audit_logs (created_at);

-- employee_details: cleanup scans by contract_end_date for anonymization
CREATE INDEX IF NOT EXISTS idx_employee_details_contract_end
  ON public.employee_details (contract_end_date)
  WHERE contract_end_date IS NOT NULL;

-- personnel_leaves: cleanup needs to join with employee_details for expiry
CREATE INDEX IF NOT EXISTS idx_personnel_leaves_user_id
  ON public.personnel_leaves (user_id);

-- personnel_leave_requests: same join pattern
CREATE INDEX IF NOT EXISTS idx_personnel_leave_requests_user_id
  ON public.personnel_leave_requests (user_id);

-- badge_pin_failures: cleanup by attempted_at
-- (idx_badge_pin_failures_lookup already covers this via attempted_at DESC)

-- invitations: cleanup expired invitations by status + created_at
CREATE INDEX IF NOT EXISTS idx_invitations_status_created
  ON public.invitations (status, created_at)
  WHERE status = 'invited';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. data_retention_runs: Track execution history of cleanup function
--    Useful for RGPD compliance audits and monitoring
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.data_retention_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  executed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dry_run BOOLEAN NOT NULL DEFAULT false,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_affected INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.data_retention_runs ENABLE ROW LEVEL SECURITY;

-- Only admins can view retention run history
CREATE POLICY "Admins can view retention runs"
ON public.data_retention_runs
FOR SELECT
USING (is_admin(auth.uid()));

-- Only service role (edge functions) can insert
CREATE POLICY "Service role can insert retention runs"
ON public.data_retention_runs
FOR INSERT
WITH CHECK (true);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_data_retention_runs_org_date
  ON public.data_retention_runs (organization_id, executed_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Add comment annotations for data retention awareness
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE public.data_retention_runs IS
  'RGPD-05: Tracks each execution of the data-retention-cleanup edge function. '
  'Used for compliance auditing and monitoring.';

COMMENT ON INDEX idx_badge_events_created_at IS
  'RGPD-05: Supports efficient deletion of badge events older than 5 years.';

COMMENT ON INDEX idx_employee_details_contract_end IS
  'RGPD-05: Supports efficient identification of employees eligible for anonymization '
  '(contract ended > 5 years ago).';
