-- ===============================================================================
-- Fix Vision AI Scan History RLS policies
-- ===============================================================================
-- Problem: SELECT policies on vision_ai_scans only check owner_id OR is_admin(),
-- which means non-owner team members in the same establishment see no data.
-- INSERT policy only allows owner_id = auth.uid(), which is correct for writes
-- but doesn't account for establishment membership.
--
-- Fix: Use get_user_establishment_ids() — the standard RBAC helper used across
-- all other RLS policies in this codebase — to also grant access to any user
-- who belongs to the same establishment.
-- ===============================================================================

-- ── vision_ai_scans ──

-- Drop existing policies
DROP POLICY IF EXISTS "scan_owner_select" ON vision_ai_scans;
DROP POLICY IF EXISTS "scan_owner_insert" ON vision_ai_scans;
DROP POLICY IF EXISTS "scan_owner_delete" ON vision_ai_scans;

-- SELECT: owner, establishment member, or admin
CREATE POLICY "scan_establishment_select" ON vision_ai_scans
  FOR SELECT USING (
    auth.uid() = owner_id
    OR establishment_id IN (SELECT public.get_user_establishment_ids())
  );

-- INSERT: any authenticated user in the establishment
CREATE POLICY "scan_establishment_insert" ON vision_ai_scans
  FOR INSERT WITH CHECK (
    auth.uid() = owner_id
    AND establishment_id IN (SELECT public.get_user_establishment_ids())
  );

-- DELETE: owner or admin only
CREATE POLICY "scan_owner_or_admin_delete" ON vision_ai_scans
  FOR DELETE USING (
    auth.uid() = owner_id
    OR is_admin(auth.uid())
  );

-- ── vision_ai_scan_runs ──

-- Drop existing policies
DROP POLICY IF EXISTS "scan_run_select" ON vision_ai_scan_runs;
DROP POLICY IF EXISTS "scan_run_insert" ON vision_ai_scan_runs;
DROP POLICY IF EXISTS "scan_run_delete" ON vision_ai_scan_runs;

-- SELECT: if user can see the parent scan (via establishment membership)
CREATE POLICY "scan_run_establishment_select" ON vision_ai_scan_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vision_ai_scans s
      WHERE s.id = vision_ai_scan_runs.scan_id
        AND (
          s.owner_id = auth.uid()
          OR s.establishment_id IN (SELECT public.get_user_establishment_ids())
        )
    )
  );

-- INSERT: if user can see the parent scan
CREATE POLICY "scan_run_establishment_insert" ON vision_ai_scan_runs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM vision_ai_scans s
      WHERE s.id = vision_ai_scan_runs.scan_id
        AND (
          s.owner_id = auth.uid()
          OR s.establishment_id IN (SELECT public.get_user_establishment_ids())
        )
    )
  );

-- DELETE: owner or admin of parent scan
CREATE POLICY "scan_run_owner_or_admin_delete" ON vision_ai_scan_runs
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM vision_ai_scans s
      WHERE s.id = vision_ai_scan_runs.scan_id
        AND (
          s.owner_id = auth.uid()
          OR is_admin(auth.uid())
        )
    )
  );
