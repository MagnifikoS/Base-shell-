import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { formatTime, timeToMinutes, normalizeEndMinutes } from "./time.ts";
import { resolveOpeningWindow, validateShiftInOpeningWindow } from "./openingHours.ts";
import { getActiveBreakPolicy, computeBreakMinutes } from "./breakPolicy.ts";
// NOTE: Auto-invalidation removed - validation is 100% manual (see planning-validation-policy)
import { buildParisInstant, getPreviousDay, getNextDay } from "./parisTime.ts";

type AnyClient = SupabaseClient;

interface ShiftRow {
  id: string;
  user_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  net_minutes: number;
  break_minutes: number;
  updated_at: string;
}

interface UpdateShiftBody {
  action: "update_shift";
  establishment_id: string;
  shift_id: string;
  start_time: string;
  end_time: string;
  new_shift_date?: string; // Optional: for drag & drop to new date
}

interface UpdateShiftResult {
  data?: { shift: ShiftRow };
  error?: string;
  status: number;
}

/**
 * Check if new shift overlaps with already worked time (badge_events)
 * Returns error string if overlap detected, null otherwise
 * 
 * SCOPE: Queries shift_date + (shift_date - 1) ONLY if overnight shift
 * 
 * NEW LOGIC (per business rules):
 * - Case A: No clock_in → fully modifiable
 * - Case B: clock_in exists, clock_out null → start_time locked, end_time modifiable
 * - Case C: clock_in AND clock_out exist → block modifications overlapping worked interval
 * 
 * IMPORTANT: We no longer use workedEnd = now() when clock_out is null.
 * This was blocking ALL modifications, which is incorrect.
 */
async function checkWorkedTimeOverlap(
  adminClient: AnyClient,
  establishmentId: string,
  employeeId: string,
  shiftDate: string,
  newStartTs: Date,
  newEndTs: Date,
  isOvernight: boolean,
  originalStartTime?: string // Pass original start_time for comparison
): Promise<string | null> {
  // Build day_date list: always include shiftDate, add previous day only if overnight
  const dayDates = [shiftDate];
  if (isOvernight) {
    dayDates.push(getPreviousDay(shiftDate));
  }

  // Fetch badge_events for this user/establishment/days
  const { data: events, error } = await adminClient
    .from("badge_events")
    .select("id, event_type, effective_at, occurred_at, sequence_index, day_date")
    .eq("establishment_id", establishmentId)
    .eq("user_id", employeeId)
    .in("day_date", dayDates)
    .order("day_date", { ascending: true })
    .order("sequence_index", { ascending: true })
    .order("effective_at", { ascending: true });

  if (error) {
    console.error("Failed to fetch badge_events for overlap check:", error);
    return "WORKED_TIME_OVERLAP_CHECK_FAILED"; // FAIL-CLOSE: block if check cannot be performed
  }

  if (!events || events.length === 0) {
    // Case A: No badge events = no worked time → fully modifiable
    return null;
  }

  // Group events by (day_date + sequence_index) to build worked intervals
  const byKey = new Map<string, { clockIn?: string; clockOut?: string }>();
  for (const evt of events) {
    const key = `${evt.day_date}_${evt.sequence_index}`;
    if (!byKey.has(key)) {
      byKey.set(key, {});
    }
    const entry = byKey.get(key)!;
    if (evt.event_type === "clock_in") {
      entry.clockIn = evt.effective_at || evt.occurred_at;
    } else if (evt.event_type === "clock_out") {
      entry.clockOut = evt.effective_at || evt.occurred_at;
    }
  }

  // Check each worked interval
  for (const [_key, interval] of byKey) {
    if (!interval.clockIn) continue; // No clock_in = no worked interval

    const workedStart = new Date(interval.clockIn);

    // CASE B: clock_in exists, clock_out is NULL
    // Rule: start_time is locked (cannot conflict with clock_in), end_time is modifiable
    if (!interval.clockOut) {
      // Only check if the new start_time conflicts with clock_in
      // If the new start moves AFTER the clock_in (badge already happened earlier),
      // or moves to a completely different position that's incoherent, block it.
      // Otherwise, allow end_time modifications freely.
      
      // If originalStartTime is provided, check if start_time actually changed
      const newStartStr = formatTime(newStartTs.toISOString().substring(11, 16));
      const startChanged = originalStartTime && formatTime(originalStartTime) !== newStartStr;
      
      if (startChanged) {
        // Start time changed - check if it's now AFTER the clock_in (which is invalid)
        // Worker already clocked in at workedStart, new planned start must be <= workedStart
        if (newStartTs > workedStart) {
          return "START_TIME_LOCKED_BY_CLOCK_IN";
        }
      }
      
      // end_time can be freely modified since clock_out hasn't happened yet
      continue;
    }

    // CASE C: clock_in AND clock_out both exist
    // Block modifications that overlap the actual worked interval
    const workedEnd = new Date(interval.clockOut);

    // Overlap rule: newStart < workedEnd AND newEnd > workedStart
    if (newStartTs < workedEnd && newEndTs > workedStart) {
      return "SHIFT_OVERLAPS_WORKED_TIME";
    }
  }

  return null;
}

/**
 * Helper to format timestamp to HH:mm
 */
function _formatTimeFromTs(ts: Date): string {
  const h = String(ts.getHours()).padStart(2, "0");
  const m = String(ts.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export async function handleUpdateShift(
  body: UpdateShiftBody,
  userId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<UpdateShiftResult> {
  const { establishment_id, shift_id, start_time, end_time, new_shift_date } = body;

  // Validate required fields
  if (!establishment_id || !shift_id || !start_time || !end_time) {
    return { error: "Missing required fields", status: 400 };
  }

  // ══════════════════════════════════════════════════════════════
  // RBAC CHECK via userClient (JWT) - has_module_access handles admin internally
  // ══════════════════════════════════════════════════════════════
  const { data: hasAccess, error: accessError } = await userClient.rpc("has_module_access", {
    _module_key: "planning",
    _min_level: "write",
    _establishment_id: establishment_id,
  });

  if (accessError) {
    console.error("RBAC check error:", accessError);
    return { error: "Permission check failed", status: 500 };
  }

  if (!hasAccess) {
    return { error: "Planning write access required", status: 403 };
  }

  // Get scope for self/team restriction via V2 (scoped by establishment)
  const { data: permsData } = await userClient.rpc("get_my_permissions_v2", {
    _establishment_id: establishment_id,
  });
  const perms = permsData as {
    permissions?: Array<{ module_key: string; scope: string }>;
    team_ids?: string[];
  } | null;
  const planningPerm = perms?.permissions?.find(p => p.module_key === "planning");
  const planningScope = planningPerm?.scope;

  // Get org ID
  const { data: orgId, error: orgError } = await userClient.rpc("get_user_organization_id");
  if (orgError || !orgId) {
    return { error: "Organization not found", status: 400 };
  }

  // Load existing shift (atomic read)
  const { data: existingShift, error: shiftError } = await adminClient
    .from("planning_shifts")
    .select("id, organization_id, establishment_id, user_id, shift_date, start_time, end_time")
    .eq("id", shift_id)
    .single();

  if (shiftError || !existingShift) {
    return { error: "Shift not found", status: 404 };
  }

  // Verify scoping: organization
  if (existingShift.organization_id !== orgId) {
    return { error: "Shift does not belong to your organization", status: 403 };
  }

  // Verify scoping: establishment
  if (existingShift.establishment_id !== establishment_id) {
    return { error: "Shift does not belong to this establishment", status: 403 };
  }

  const originalShiftDate = existingShift.shift_date;
  const targetShiftDate = new_shift_date || originalShiftDate;
  const employeeId = existingShift.user_id;

  // Scope restriction: self means can only manage own shifts
  if (planningScope === "self" && employeeId !== userId) {
    return { error: "Forbidden: self scope", status: 403 };
  }

  // Scope restriction: team means can only manage shifts for team members
  if (planningScope === "team" && employeeId !== userId) {
    const userTeamIds = perms?.team_ids || [];
    if (userTeamIds.length === 0) {
      return { error: "Forbidden: team scope (no teams)", status: 403 };
    }
    const { data: teamUsers } = await adminClient
      .from("user_teams")
      .select("user_id")
      .in("team_id", userTeamIds);
    const teamUserIds = new Set((teamUsers || []).map(tu => tu.user_id));
    if (!teamUserIds.has(employeeId)) {
      return { error: "Forbidden: team scope", status: 403 };
    }
  }

  // ══════════════════════════════════════════════════════════════
  // AUTO-DÉVALIDATION: Will unvalidate affected days after successful update
  // No blocking - modifications are allowed but trigger auto-unvalidation
  // ══════════════════════════════════════════════════════════════

  // Verify employee is still active
  const { data: profile } = await adminClient
    .from("profiles")
    .select("status")
    .eq("user_id", employeeId)
    .single();

  if (!profile || profile.status !== "active") {
    return { error: "Employee suspended", status: 403 };
  }

  // Calculate times with midnight normalization
  const shiftStartMin = timeToMinutes(formatTime(start_time));
  const shiftEndMin = normalizeEndMinutes(shiftStartMin, end_time);

  // Validate end > start
  if (shiftEndMin <= shiftStartMin) {
    return { error: "Invalid time range", status: 400 };
  }

  // ══════════════════════════════════════════════════════════════
  // GARDE-FOU 2: Reuse openingHours.ts (no duplication)
  // ══════════════════════════════════════════════════════════════
  const openingWindow = await resolveOpeningWindow(adminClient, establishment_id, targetShiftDate);
  const openingError = validateShiftInOpeningWindow(shiftStartMin, shiftEndMin, openingWindow);
  if (openingError) {
    return { error: openingError, status: 400 };
  }

  // ══════════════════════════════════════════════════════════════
  // Check overlap with other shifts on target date (if moving or same date)
  // ══════════════════════════════════════════════════════════════
  const { data: otherShifts } = await adminClient
    .from("planning_shifts")
    .select("id, start_time, end_time")
    .eq("establishment_id", establishment_id)
    .eq("user_id", employeeId)
    .eq("shift_date", targetShiftDate)
    .neq("id", shift_id); // Exclude current shift

  if (otherShifts && otherShifts.length > 0) {
    // Check max 2 shifts per day (current shift + others should not exceed 2)
    if (otherShifts.length >= 2) {
      return { error: "Maximum 2 shifts per day", status: 400 };
    }

    // Check overlap
    for (const other of otherShifts) {
      const otherStartMin = timeToMinutes(formatTime(other.start_time));
      const otherEndMin = normalizeEndMinutes(otherStartMin, other.end_time);
      
      const hasOverlap = shiftStartMin < otherEndMin && shiftEndMin > otherStartMin;
      if (hasOverlap) {
        return { error: "Shift overlaps with existing shift", status: 400 };
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // CHECK OVERLAP WITH WORKED TIME (badge_events)
  // Uses DST-safe buildParisInstant (not naive setHours)
  // ══════════════════════════════════════════════════════════════
  const isOvernight = shiftEndMin > 1440;
  const newStartTs = buildParisInstant(targetShiftDate, start_time);
  // Overnight: end_time belongs to targetShiftDate + 1
  const endDateStr = isOvernight ? getNextDay(targetShiftDate) : targetShiftDate;
  const newEndTs = buildParisInstant(endDateStr, end_time);

  const workedOverlapError = await checkWorkedTimeOverlap(
    adminClient,
    establishment_id,
    employeeId,
    targetShiftDate,
    newStartTs,
    newEndTs,
    isOvernight,
    existingShift.start_time // Pass original start_time for comparison
  );
  if (workedOverlapError) {
    const status = workedOverlapError === "WORKED_TIME_OVERLAP_CHECK_FAILED" ? 503 : 400;
    return { error: workedOverlapError, status };
  }

  // ══════════════════════════════════════════════════════════════
  // GARDE-FOU 2: Reuse breakPolicy.ts (no duplication)
  // ══════════════════════════════════════════════════════════════
  const { policy, error: policyError } = await getActiveBreakPolicy(adminClient, establishment_id);
  if (policyError) {
    return { error: policyError, status: 500 };
  }

  // Calculate duration and break minutes
  const durationMinutes = shiftEndMin - shiftStartMin;
  const breakMinutes = computeBreakMinutes(policy, start_time, end_time, durationMinutes);
  const netMinutes = Math.max(0, durationMinutes - breakMinutes);

  // ══════════════════════════════════════════════════════════════
  // GARDE-FOU 1: Atomic update (single UPDATE query)
  // ══════════════════════════════════════════════════════════════
  const updatePayload: Record<string, unknown> = {
    start_time,
    end_time,
    break_minutes: breakMinutes,
    net_minutes: netMinutes,
    updated_at: new Date().toISOString(),
  };
  
  // Include new_shift_date if provided (for drag & drop)
  if (new_shift_date && new_shift_date !== originalShiftDate) {
    updatePayload.shift_date = new_shift_date;
  }

  const { data: updatedShift, error: updateError } = await adminClient
    .from("planning_shifts")
    .update(updatePayload)
    .eq("id", shift_id)
    .select("id, user_id, shift_date, start_time, end_time, net_minutes, break_minutes, updated_at")
    .single();

  if (updateError || !updatedShift) {
    console.error("Update shift error:", updateError);
    return { error: "Failed to update shift", status: 500 };
  }

  const shift: ShiftRow = {
    id: updatedShift.id,
    user_id: updatedShift.user_id,
    shift_date: updatedShift.shift_date,
    start_time: formatTime(updatedShift.start_time),
    end_time: formatTime(updatedShift.end_time),
    net_minutes: updatedShift.net_minutes,
    break_minutes: updatedShift.break_minutes,
    updated_at: updatedShift.updated_at,
  };

  return { data: { shift }, status: 200 };
}

/**
 * Get Monday of the week for a given date (ISO week)
 */
function _getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
