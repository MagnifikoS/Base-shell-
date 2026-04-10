-- ============================================================
-- ATOMIC SHIFT CREATION FUNCTION
-- Prevents race condition: max 2 shifts per (establishment, user, date)
-- Uses pg_advisory_xact_lock to serialize concurrent requests
-- ============================================================

CREATE OR REPLACE FUNCTION public.planning_create_shift_atomic(
  p_organization_id UUID,
  p_establishment_id UUID,
  p_user_id UUID,
  p_shift_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_break_minutes INTEGER,
  p_net_minutes INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key BIGINT;
  v_existing_count INTEGER;
  v_new_shift planning_shifts%ROWTYPE;
BEGIN
  -- ══════════════════════════════════════════════════════════════
  -- STEP 1: Generate a collision-resistant 64-bit lock key
  -- Using md5 hash of the tuple (establishment_id, user_id, shift_date)
  -- Extract first 16 hex chars and convert to bigint
  -- ══════════════════════════════════════════════════════════════
  v_lock_key := ('x' || substr(
    md5(p_establishment_id::text || '|' || p_user_id::text || '|' || p_shift_date::text),
    1, 16
  ))::bit(64)::bigint;

  -- ══════════════════════════════════════════════════════════════
  -- STEP 2: Acquire advisory lock (transaction-scoped)
  -- This BLOCKS any concurrent call with the same key until we commit/rollback
  -- ══════════════════════════════════════════════════════════════
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- ══════════════════════════════════════════════════════════════
  -- STEP 3: Count existing shifts for this tuple (AFTER lock acquired)
  -- ══════════════════════════════════════════════════════════════
  SELECT COUNT(*)
  INTO v_existing_count
  FROM planning_shifts
  WHERE establishment_id = p_establishment_id
    AND user_id = p_user_id
    AND shift_date = p_shift_date;

  -- ══════════════════════════════════════════════════════════════
  -- STEP 4: If already 2 or more, reject with structured error
  -- ══════════════════════════════════════════════════════════════
  IF v_existing_count >= 2 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Maximum 2 shifts per day',
      'status', 400
    );
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- STEP 5: Insert new shift (still under lock)
  -- ══════════════════════════════════════════════════════════════
  INSERT INTO planning_shifts (
    organization_id,
    establishment_id,
    user_id,
    shift_date,
    start_time,
    end_time,
    break_minutes,
    net_minutes
  )
  VALUES (
    p_organization_id,
    p_establishment_id,
    p_user_id,
    p_shift_date,
    p_start_time,
    p_end_time,
    p_break_minutes,
    p_net_minutes
  )
  RETURNING * INTO v_new_shift;

  -- ══════════════════════════════════════════════════════════════
  -- STEP 6: Return success with the new shift data
  -- ══════════════════════════════════════════════════════════════
  RETURN jsonb_build_object(
    'ok', true,
    'shift', jsonb_build_object(
      'id', v_new_shift.id,
      'user_id', v_new_shift.user_id,
      'shift_date', v_new_shift.shift_date,
      'start_time', v_new_shift.start_time,
      'end_time', v_new_shift.end_time,
      'net_minutes', v_new_shift.net_minutes,
      'break_minutes', v_new_shift.break_minutes,
      'updated_at', v_new_shift.updated_at
    )
  );
  
  -- Lock is automatically released when transaction commits
END;
$$;