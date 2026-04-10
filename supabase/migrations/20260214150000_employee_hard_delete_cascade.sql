-- RGPD-01: Enable proper CASCADE deletion for employee-related tables
--
-- Currently, several tables reference user_id (pointing to auth.users) but lack
-- ON DELETE CASCADE. When an employee is hard-deleted via the right-to-erasure
-- (RGPD Art. 17), orphaned rows may remain. This migration adds CASCADE constraints
-- so that deleting the auth.users row (or employee_details row) cascades cleanly.
--
-- Tables affected:
--   1. badge_events         (user_id → auth.users)
--   2. personnel_leaves     (user_id → auth.users)
--   3. personnel_leave_requests (user_id → auth.users)
--   4. planning_shifts      (user_id → auth.users)
--   5. user_badge_pins      (user_id → auth.users)
--   6. user_devices         (user_id → auth.users)
--   7. payroll_employee_month_validation (user_id → auth.users)
--   8. payroll_employee_month_carry      (user_id → auth.users)
--   9. payroll_employee_extra_counter    (user_id → auth.users)
--  10. employee_documents   (user_id → auth.users)
--
-- Pattern: Drop existing constraint if any, then add with ON DELETE CASCADE.
-- Idempotent: uses DO $$ blocks with IF EXISTS / IF NOT EXISTS checks.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. badge_events.user_id → auth.users(id) ON DELETE CASCADE
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- Drop existing FK if present (may have no CASCADE)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'badge_events_user_id_fkey'
      AND table_name = 'badge_events'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.badge_events DROP CONSTRAINT badge_events_user_id_fkey;
  END IF;

  -- Add FK with CASCADE
  ALTER TABLE public.badge_events
    ADD CONSTRAINT badge_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. personnel_leaves.user_id → auth.users(id) ON DELETE CASCADE
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'personnel_leaves_user_id_fkey'
      AND table_name = 'personnel_leaves'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.personnel_leaves DROP CONSTRAINT personnel_leaves_user_id_fkey;
  END IF;

  ALTER TABLE public.personnel_leaves
    ADD CONSTRAINT personnel_leaves_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. personnel_leave_requests.user_id → auth.users(id) ON DELETE CASCADE
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'personnel_leave_requests_user_id_fkey'
      AND table_name = 'personnel_leave_requests'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.personnel_leave_requests DROP CONSTRAINT personnel_leave_requests_user_id_fkey;
  END IF;

  ALTER TABLE public.personnel_leave_requests
    ADD CONSTRAINT personnel_leave_requests_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. planning_shifts.user_id → auth.users(id) ON DELETE CASCADE
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'planning_shifts_user_id_fkey'
      AND table_name = 'planning_shifts'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.planning_shifts DROP CONSTRAINT planning_shifts_user_id_fkey;
  END IF;

  ALTER TABLE public.planning_shifts
    ADD CONSTRAINT planning_shifts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. user_badge_pins.user_id → auth.users(id) ON DELETE CASCADE
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'user_badge_pins_user_id_fkey'
      AND table_name = 'user_badge_pins'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.user_badge_pins DROP CONSTRAINT user_badge_pins_user_id_fkey;
  END IF;

  ALTER TABLE public.user_badge_pins
    ADD CONSTRAINT user_badge_pins_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. user_devices.user_id → auth.users(id) ON DELETE CASCADE
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'user_devices_user_id_fkey'
      AND table_name = 'user_devices'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.user_devices DROP CONSTRAINT user_devices_user_id_fkey;
  END IF;

  ALTER TABLE public.user_devices
    ADD CONSTRAINT user_devices_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. payroll_employee_month_validation.user_id → auth.users(id) ON DELETE CASCADE
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'payroll_employee_month_validation_user_id_fkey'
      AND table_name = 'payroll_employee_month_validation'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.payroll_employee_month_validation DROP CONSTRAINT payroll_employee_month_validation_user_id_fkey;
  END IF;

  ALTER TABLE public.payroll_employee_month_validation
    ADD CONSTRAINT payroll_employee_month_validation_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. payroll_employee_month_carry.user_id → auth.users(id) ON DELETE CASCADE
-- SAFE: Only runs if table exists (may not exist on fresh installs)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payroll_employee_month_carry' AND table_schema = 'public') THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'payroll_employee_month_carry_user_id_fkey'
        AND table_name = 'payroll_employee_month_carry'
        AND table_schema = 'public'
    ) THEN
      ALTER TABLE public.payroll_employee_month_carry DROP CONSTRAINT payroll_employee_month_carry_user_id_fkey;
    END IF;

    ALTER TABLE public.payroll_employee_month_carry
      ADD CONSTRAINT payroll_employee_month_carry_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. payroll_employee_extra_counter.user_id → auth.users(id) ON DELETE CASCADE
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payroll_employee_extra_counter' AND table_schema = 'public') THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'payroll_employee_extra_counter_user_id_fkey'
        AND table_name = 'payroll_employee_extra_counter'
        AND table_schema = 'public'
    ) THEN
      ALTER TABLE public.payroll_employee_extra_counter DROP CONSTRAINT payroll_employee_extra_counter_user_id_fkey;
    END IF;

    ALTER TABLE public.payroll_employee_extra_counter
      ADD CONSTRAINT payroll_employee_extra_counter_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. employee_documents.user_id → auth.users(id) ON DELETE CASCADE
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'employee_documents_user_id_fkey'
      AND table_name = 'employee_documents'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.employee_documents DROP CONSTRAINT employee_documents_user_id_fkey;
  END IF;

  ALTER TABLE public.employee_documents
    ADD CONSTRAINT employee_documents_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Add DELETE RLS policy for employee_details (needed for cascade cleanup)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- Service role bypasses RLS, but add a policy for completeness
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'employee_details'
      AND policyname = 'Service role can delete employee details'
  ) THEN
    CREATE POLICY "Service role can delete employee details"
    ON public.employee_details
    FOR DELETE
    USING (true); -- Service role always bypasses RLS; this is a safety net
  END IF;
END $$;
