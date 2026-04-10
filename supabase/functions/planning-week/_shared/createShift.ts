import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { formatTime, timeToMinutes, normalizeEndMinutes } from "./time.ts";
import { resolveOpeningWindow, validateShiftInOpeningWindow } from "./openingHours.ts";
import { computeBreakMinutes } from "./breakPolicy.ts";
import type { ActiveBreakPolicy } from "./breakPolicy.ts";
import { buildParisInstant, getPreviousDay, getNextDay } from "./parisTime.ts";
import { RequestProfiler } from "./profiler.ts";
import { RequestContext } from "./requestContext.ts";

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

interface CreateShiftBody {
  action: "create_shift";
  establishment_id: string;
  shift_date: string;
  user_id: string;
  start_time: string;
  end_time: string;
}

interface CreateShiftResult {
  data?: { shift: ShiftRow };
  error?: string;
  status: number;
}

/**
 * Check if new shift overlaps with already worked time (badge_events)
 */
async function checkWorkedTimeOverlap(
  adminClient: AnyClient,
  establishmentId: string,
  employeeId: string,
  shiftDate: string,
  newStartTs: Date,
  newEndTs: Date,
  isOvernight: boolean
): Promise<string | null> {
  const dayDates = [shiftDate];
  if (isOvernight) {
    dayDates.push(getPreviousDay(shiftDate));
  }

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
    return "WORKED_TIME_OVERLAP_CHECK_FAILED";
  }

  if (!events || events.length === 0) return null;

  const byKey = new Map<string, { clockIn?: string; clockOut?: string }>();
  for (const evt of events) {
    const key = `${evt.day_date}_${evt.sequence_index}`;
    if (!byKey.has(key)) byKey.set(key, {});
    const entry = byKey.get(key)!;
    if (evt.event_type === "clock_in") entry.clockIn = evt.effective_at || evt.occurred_at;
    else if (evt.event_type === "clock_out") entry.clockOut = evt.effective_at || evt.occurred_at;
  }

  const nowTs = new Date();
  for (const [_key, interval] of byKey) {
    if (!interval.clockIn) continue;
    const workedStart = new Date(interval.clockIn);
    const workedEnd = interval.clockOut ? new Date(interval.clockOut) : nowTs;
    if (newStartTs < workedEnd && newEndTs > workedStart) {
      return "SHIFT_OVERLAPS_WORKED_TIME";
    }
  }

  return null;
}

export async function handleCreateShift(
  body: CreateShiftBody,
  userId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<CreateShiftResult> {
  const prof = new RequestProfiler("create_shift");
  const ctx = new RequestContext(userClient, adminClient, userId);

  const { establishment_id, shift_date, user_id: employeeId, start_time, end_time } = body;

  if (!establishment_id || !shift_date || !employeeId || !start_time || !end_time) {
    return { error: "Missing required fields", status: 400 };
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE A: RBAC + permissions (sequential — gate check)
  // ══════════════════════════════════════════════════════════════
  const hasAccess = await prof.time("rbac_check", () =>
    ctx.hasModuleAccess("planning", "write", establishment_id)
  );
  if (!hasAccess) {
    prof.flush();
    return { error: "Planning write access required", status: 403 };
  }

  // Get scope for self/team restriction (cached — shares with hasModuleAccess via ctx)
  const { scope: planningScope, teamIds: userTeamIds } = await prof.time(
    "get_planning_permission",
    () => ctx.getPlanningPermission(establishment_id)
  );

  // Scope restriction: self
  if (planningScope === "self" && employeeId !== userId) {
    prof.flush();
    return { error: "Forbidden: self scope", status: 403 };
  }

  // Scope restriction: team
  if (planningScope === "team" && employeeId !== userId) {
    if (userTeamIds.length === 0) {
      prof.flush();
      return { error: "Forbidden: team scope (no teams)", status: 403 };
    }
    const teamCheck = await prof.time("team_scope_check", async () => {
      const { data: teamUsers } = await adminClient.from("user_teams").select("user_id").in("team_id", userTeamIds);
      return new Set((teamUsers || []).map(tu => tu.user_id));
    });
    if (!teamCheck.has(employeeId)) {
      prof.flush();
      return { error: "Forbidden: team scope", status: 403 };
    }
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE B: Parallel independent fetches
  // orgId, establishment, user_establishment, profile, day_parts, break_policy
  // ══════════════════════════════════════════════════════════════
  const [orgId, establishment, userEst, profile, dayPartsData, breakPolicyRaw] = await prof.timeAll([
    { name: "get_org_id", fn: () => ctx.getOrgId().catch(() => null as string | null) },
    { name: "get_establishment", fn: () => ctx.getEstablishment(establishment_id).catch(() => null) },
    {
      name: "user_establishment_check",
      fn: () => adminClient.from("user_establishments").select("id").eq("user_id", employeeId).eq("establishment_id", establishment_id).single().then(r => r.data),
    },
    {
      name: "profile_check",
      fn: () => adminClient.from("profiles").select("status").eq("user_id", employeeId).single().then(r => r.data),
    },
    {
      name: "day_parts",
      fn: () => ctx.getDayParts(establishment_id),
    },
    {
      name: "break_policy",
      fn: () => ctx.getBreakPolicy(establishment_id).catch(() => null),
    },
  ] as const);

  if (!orgId) { prof.flush(); return { error: "Organization not found", status: 400 }; }
  if (!establishment || establishment.organization_id !== orgId) {
    prof.flush();
    return { error: "Establishment not found or forbidden", status: 403 };
  }
  if (!userEst) { prof.flush(); return { error: "Employee not assigned to this establishment", status: 400 }; }
  if (!profile || (profile as { status: string }).status !== "active") {
    prof.flush();
    return { error: "Employee suspended", status: 403 };
  }

  // Day parts validation
  const parts = (dayPartsData as Array<{ part: string }>).map(d => d.part);
  if (!parts.includes("morning") || !parts.includes("midday") || !parts.includes("evening")) {
    prof.flush();
    return { error: "Day parts not configured", status: 400 };
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE C: Time calculations + sequential validations
  // ══════════════════════════════════════════════════════════════
  const shiftStartMin = timeToMinutes(formatTime(start_time));
  const shiftEndMin = normalizeEndMinutes(shiftStartMin, end_time);

  if (shiftEndMin <= shiftStartMin) {
    prof.flush();
    return { error: "Invalid time range", status: 400 };
  }

  // Opening hours + existing shifts overlap — parallel (both depend on establishment_id + date only)
  const [openingWindow, existingShifts] = await prof.timeAll([
    {
      name: "opening_window",
      fn: () => resolveOpeningWindow(adminClient, establishment_id, shift_date),
    },
    {
      name: "existing_shifts",
      fn: () => adminClient.from("planning_shifts")
        .select("id, start_time, end_time")
        .eq("establishment_id", establishment_id)
        .eq("user_id", employeeId)
        .eq("shift_date", shift_date)
        .then(r => r.data || []),
    },
  ] as const);

  // Validate opening hours
  const openingError = validateShiftInOpeningWindow(shiftStartMin, shiftEndMin, openingWindow);
  if (openingError) {
    prof.flush();
    return { error: openingError, status: 400 };
  }

  // Overlap check with existing shifts
  if (existingShifts && (existingShifts as Array<{ id: string; start_time: string; end_time: string }>).length > 0) {
    for (const existing of existingShifts as Array<{ id: string; start_time: string; end_time: string }>) {
      const existingStartMin = timeToMinutes(formatTime(existing.start_time));
      const existingEndMin = normalizeEndMinutes(existingStartMin, existing.end_time);
      if (shiftStartMin < existingEndMin && shiftEndMin > existingStartMin) {
        prof.flush();
        return { error: "Shift overlaps with existing shift", status: 400 };
      }
    }
  }

  // Badge overlap check
  const isOvernight = shiftEndMin > 1440;
  const newStartTs = buildParisInstant(shift_date, start_time);
  const endDateStr = isOvernight ? getNextDay(shift_date) : shift_date;
  const newEndTs = buildParisInstant(endDateStr, end_time);

  const workedOverlapError = await prof.time("badge_overlap_check", () =>
    checkWorkedTimeOverlap(adminClient, establishment_id, employeeId, shift_date, newStartTs, newEndTs, isOvernight)
  );
  if (workedOverlapError) {
    prof.flush();
    const status = workedOverlapError === "WORKED_TIME_OVERLAP_CHECK_FAILED" ? 503 : 400;
    return { error: workedOverlapError, status };
  }

  // ══════════════════════════════════════════════════════════════
  // Calculate break + insert atomically
  // ══════════════════════════════════════════════════════════════
  const policy = breakPolicyRaw ? { id: (breakPolicyRaw as { id: string }).id, policy_json: (breakPolicyRaw as { policy_json: unknown }).policy_json } as ActiveBreakPolicy : null;
  const durationMinutes = shiftEndMin - shiftStartMin;
  const breakMinutes = computeBreakMinutes(policy, start_time, end_time, durationMinutes);
  const netMinutes = Math.max(0, durationMinutes - breakMinutes);

  const { data: rpcResult, error: rpcError } = await prof.time("atomic_insert", () =>
    adminClient.rpc("planning_create_shift_atomic", {
      p_organization_id: orgId,
      p_establishment_id: establishment_id,
      p_user_id: employeeId,
      p_shift_date: shift_date,
      p_start_time: start_time,
      p_end_time: end_time,
      p_break_minutes: breakMinutes,
      p_net_minutes: netMinutes,
    })
  );

  if (rpcError) {
    console.error("RPC planning_create_shift_atomic error:", rpcError);
    prof.flush();
    return { error: "Failed to create shift", status: 500 };
  }

  if (!rpcResult.ok) {
    prof.flush();
    return { error: rpcResult.error, status: rpcResult.status };
  }

  const shiftData = rpcResult.shift;
  const shift: ShiftRow = {
    id: shiftData.id,
    user_id: shiftData.user_id,
    shift_date: shiftData.shift_date,
    start_time: formatTime(shiftData.start_time),
    end_time: formatTime(shiftData.end_time),
    net_minutes: shiftData.net_minutes,
    break_minutes: shiftData.break_minutes,
    updated_at: shiftData.updated_at,
  };

  prof.flush();
  return { data: { shift }, status: 201 };
}
