-- Part 5: Restore planning_create_shift_atomic
CREATE OR REPLACE FUNCTION public.planning_create_shift_atomic(
  p_organization_id uuid, 
  p_establishment_id uuid, 
  p_user_id uuid, 
  p_shift_date date, 
  p_start_time time without time zone, 
  p_end_time time without time zone, 
  p_break_minutes integer, 
  p_net_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key BIGINT;
  v_existing_count INTEGER;
  v_new_shift planning_shifts%ROWTYPE;
BEGIN
  v_lock_key := ('x' || substr(
    md5(p_establishment_id::text || '|' || p_user_id::text || '|' || p_shift_date::text),
    1, 16
  ))::bit(64)::bigint;

  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT COUNT(*)
  INTO v_existing_count
  FROM planning_shifts
  WHERE establishment_id = p_establishment_id
    AND user_id = p_user_id
    AND shift_date = p_shift_date;

  IF v_existing_count >= 2 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Maximum 2 shifts per day',
      'status', 400
    );
  END IF;

  INSERT INTO planning_shifts (
    organization_id, establishment_id, user_id, shift_date,
    start_time, end_time, break_minutes, net_minutes
  )
  VALUES (
    p_organization_id, p_establishment_id, p_user_id, p_shift_date,
    p_start_time, p_end_time, p_break_minutes, p_net_minutes
  )
  RETURNING * INTO v_new_shift;

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
END;
$$;
