import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { formatTime, calculateDurationMinutes, timeToMinutes, normalizeEndMinutes } from "./time.ts";
import { computeRextraBalanceForUsers } from "./rextraBalance.ts";
import { isAutoPublishActive, getServiceDayMonday, getNextWeekMonday, getTodayParis } from "./parisTime.ts";
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

interface EmployeeRow {
  user_id: string;
  full_name: string | null;
  status: string;
  team_id: string | null;
  team_name: string | null;
}

interface GetWeekBody {
  action: "get_week";
  establishment_id: string;
  week_start: string;
  team_ids?: string[];
}

interface GetWeekResult {
  data?: unknown;
  error?: string;
  status: number;
}

function calculateWeekEnd(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00");
  d.setDate(d.getDate() + 6);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Filter user IDs based on scope
 */
async function filterUserIdsByScope(
  adminClient: AnyClient,
  allUserIds: string[],
  requestingUserId: string,
  scope: string,
  teamIds: string[],
  isAdmin: boolean
): Promise<string[]> {
  if (isAdmin || scope === "org" || scope === "establishment") {
    return allUserIds;
  }

  if (scope === "team") {
    if (teamIds.length === 0) {
      return allUserIds.filter((uid) => uid === requestingUserId);
    }
    const { data: teamUsers } = await adminClient
      .from("user_teams")
      .select("user_id")
      .in("team_id", teamIds);
    const teamUserIds = new Set((teamUsers || []).map((tu) => tu.user_id));
    return allUserIds.filter((uid) => teamUserIds.has(uid));
  }

  return allUserIds.filter((uid) => uid === requestingUserId);
}

export async function handleGetWeek(
  body: GetWeekBody,
  userId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<GetWeekResult> {
  const prof = new RequestProfiler("get_week");
  const ctx = new RequestContext(userClient, adminClient, userId);

  const { establishment_id: providedEstablishmentId, week_start } = body;

  if (!week_start) {
    return { error: "week_start is required", status: 400 };
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE A: Resolve establishment + org + permissions (sequential — dependencies)
  // ══════════════════════════════════════════════════════════════
  let establishment_id = providedEstablishmentId;

  if (!establishment_id) {
    const estIds = await prof.time("get_user_establishment_ids", async () => {
      const { data, error } = await userClient.rpc("get_user_establishment_ids");
      if (error || !data || data.length === 0) return null;
      if (data.length > 1) return null;
      return data;
    });
    if (!estIds) {
      prof.flush();
      return { error: "No establishment assigned or multiple — selection required", status: 400 };
    }
    establishment_id = estIds[0];
  }

  // Parallel: orgId + establishment (no dependency between them)
  const [orgId, establishment] = await prof.timeAll([
    { name: "get_org_id", fn: () => ctx.getOrgId().catch(() => null as string | null) },
    { name: "get_establishment", fn: () => ctx.getEstablishment(establishment_id!).catch(() => null) },
  ] as const);

  if (!orgId) { prof.flush(); return { error: "Organization not found", status: 400 }; }
  if (!establishment) { prof.flush(); return { error: "Establishment not found", status: 404 }; }
  if (establishment.organization_id !== orgId) { prof.flush(); return { error: "Forbidden", status: 403 }; }

  // Get permissions (depends on establishment_id)
  const { accessLevel, scope: planningScope, teamIds: userTeamIds, isAdmin } = await prof.time(
    "get_planning_permission",
    () => ctx.getPlanningPermission(establishment_id!)
  );

  if (accessLevel === "none" || !accessLevel) {
    prof.flush();
    return { error: "Forbidden: insufficient planning permissions", status: 403 };
  }

  const hasFullAccess = accessLevel === "full" || planningScope === "org" || isAdmin;
  const weekEnd = calculateWeekEnd(week_start);

  // ══════════════════════════════════════════════════════════════
  // PHASE B: Parallel bulk fetches (all independent of each other)
  // teams, user_establishments, day_parts, opening data, planning_weeks
  // ══════════════════════════════════════════════════════════════
  const [teamsData, userEstablishments, dayPartsData, exceptionsData, weeklyHoursData, planningWeekRaw] = await prof.timeAll([
    {
      name: "teams",
      fn: () => adminClient.from("teams").select("id, name").eq("organization_id", orgId).eq("status", "active").order("name").then(r => r.data || []),
    },
    {
      name: "user_establishments",
      fn: () => adminClient.from("user_establishments").select("user_id").eq("establishment_id", establishment_id!).then(r => r.data || []),
    },
    {
      name: "day_parts",
      fn: () => ctx.getDayParts(establishment_id!),
    },
    {
      name: "opening_exceptions",
      fn: () => adminClient.from("establishment_opening_exceptions").select("date, closed, open_time, close_time").eq("establishment_id", establishment_id!).gte("date", week_start).lte("date", weekEnd).then(r => r.data || []),
    },
    {
      name: "opening_hours",
      fn: () => adminClient.from("establishment_opening_hours").select("day_of_week, closed, open_time, close_time").eq("establishment_id", establishment_id!).then(r => r.data || []),
    },
    {
      name: "planning_weeks",
      fn: () => adminClient.from("planning_weeks").select("week_validated, validated_days, week_invalidated_at").eq("establishment_id", establishment_id!).eq("week_start", week_start).single().then(r => r.data),
    },
  ] as const);

  const teams = teamsData as Array<{ id: string; name: string }>;
  const allUserIds = (userEstablishments as Array<{ user_id: string }>).map(ue => ue.user_id);

  // ══════════════════════════════════════════════════════════════
  // SCOPE FILTER (may require 1 query for team scope)
  // ══════════════════════════════════════════════════════════════
  let filteredUserIds = await prof.time("filter_scope", () =>
    filterUserIdsByScope(adminClient, allUserIds, userId, planningScope, userTeamIds, hasFullAccess)
  );

  // Optional team_ids param — intersect with scope
  const requestedTeamIds = body.team_ids;
  if (requestedTeamIds && Array.isArray(requestedTeamIds) && requestedTeamIds.length > 0) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validTeamIds = requestedTeamIds.filter((id: string) => UUID_RE.test(id));
    if (validTeamIds.length > 0) {
      const teamUserIds = await prof.time("team_filter_intersection", async () => {
        const { data } = await adminClient.from("user_teams").select("user_id").in("team_id", validTeamIds);
        return new Set((data || []).map((tu: { user_id: string }) => tu.user_id));
      });
      filteredUserIds = filteredUserIds.filter(uid => teamUserIds.has(uid));
    }
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE C: All employee-dependent fetches in parallel
  // profiles, user_teams, shifts, rextra_events, rextra_balances
  // ══════════════════════════════════════════════════════════════
  let employees: EmployeeRow[] = [];
  let shiftsData: ShiftRow[] = [];
  let rextraData: Array<{ user_id: string; event_date: string; minutes: number }> = [];
  let rextraBalanceByEmployee: Record<string, number> = {};

  if (filteredUserIds.length > 0) {
    const [profilesData, userTeamsData, rawShifts, rawRextra, rextraBalances] = await prof.timeAll([
      {
        name: "profiles",
        fn: () => adminClient.from("profiles").select("user_id, full_name, status").eq("organization_id", orgId).eq("status", "active").in("user_id", filteredUserIds).then(r => r.data || []),
      },
      {
        name: "user_teams",
        fn: () => adminClient.from("user_teams").select("user_id, team_id").in("user_id", filteredUserIds).then(r => r.data || []),
      },
      {
        name: "planning_shifts",
        fn: () => adminClient.from("planning_shifts")
          .select("id, user_id, shift_date, start_time, end_time, net_minutes, break_minutes, updated_at")
          .eq("organization_id", orgId).eq("establishment_id", establishment_id!)
          .gte("shift_date", week_start).lte("shift_date", weekEnd)
          .in("user_id", filteredUserIds).then(r => r.data || []),
      },
      {
        name: "rextra_events",
        fn: () => adminClient.from("planning_rextra_events").select("user_id, event_date, minutes")
          .eq("establishment_id", establishment_id!)
          .gte("event_date", week_start).lte("event_date", weekEnd)
          .in("user_id", filteredUserIds).then(r => r.data || []),
      },
      {
        name: "rextra_balances",
        fn: () => computeRextraBalanceForUsers(adminClient, establishment_id!, filteredUserIds),
      },
    ] as const);

    rextraBalanceByEmployee = rextraBalances as Record<string, number>;
    shiftsData = (rawShifts || []) as ShiftRow[];
    rextraData = (rawRextra || []) as Array<{ user_id: string; event_date: string; minutes: number }>;

    // Build employees with team info
    const userTeamMap = new Map<string, string>();
    for (const ut of (userTeamsData as Array<{ user_id: string; team_id: string }>) || []) {
      userTeamMap.set(ut.user_id, ut.team_id);
    }
    const teamMap = new Map<string, string>();
    for (const t of teams) { teamMap.set(t.id, t.name); }

    employees = ((profilesData as Array<{ user_id: string; full_name: string | null; status: string }>) || []).map(p => {
      const teamId = userTeamMap.get(p.user_id) || null;
      return {
        user_id: p.user_id,
        full_name: p.full_name,
        status: p.status,
        team_id: teamId,
        team_name: teamId ? (teamMap.get(teamId) || null) : null,
      };
    });

    employees.sort((a, b) => {
      const teamA = a.team_name || "zzz";
      const teamB = b.team_name || "zzz";
      if (teamA !== teamB) return teamA.localeCompare(teamB);
      return (a.full_name || "").localeCompare(b.full_name || "");
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Build shifts/totals (CPU only, no DB)
  // ══════════════════════════════════════════════════════════════
  const rextraByEmployeeByDate: Record<string, Record<string, number>> = {};
  for (const rextra of rextraData) {
    if (!rextraByEmployeeByDate[rextra.user_id]) rextraByEmployeeByDate[rextra.user_id] = {};
    rextraByEmployeeByDate[rextra.user_id][rextra.event_date] = rextra.minutes;
  }

  const shiftsByEmployee: Record<string, ShiftRow[]> = {};
  const totalsByEmployee: Record<string, number> = {};

  for (const emp of employees) {
    shiftsByEmployee[emp.user_id] = [];
    totalsByEmployee[emp.user_id] = 0;
  }

  for (const shift of shiftsData) {
    if (!shiftsByEmployee[shift.user_id]) shiftsByEmployee[shift.user_id] = [];
    const durationMin = calculateDurationMinutes(shift.start_time, shift.end_time);
    const netMinutes = Math.max(0, durationMin - shift.break_minutes);
    shiftsByEmployee[shift.user_id].push({
      id: shift.id,
      user_id: shift.user_id,
      shift_date: shift.shift_date,
      start_time: formatTime(shift.start_time),
      end_time: formatTime(shift.end_time),
      net_minutes: netMinutes,
      break_minutes: shift.break_minutes,
      updated_at: shift.updated_at,
    });
    totalsByEmployee[shift.user_id] = (totalsByEmployee[shift.user_id] || 0) + netMinutes;
  }

  for (const rextra of rextraData) {
    totalsByEmployee[rextra.user_id] = (totalsByEmployee[rextra.user_id] || 0) + rextra.minutes;
  }

  // ══════════════════════════════════════════════════════════════
  // Planning week record (create if missing)
  // ══════════════════════════════════════════════════════════════
  let planningWeek = planningWeekRaw;
  if (!planningWeek) {
    const { data: newWeek } = await prof.time("planning_weeks_insert", () =>
      adminClient.from("planning_weeks").insert({
        organization_id: orgId,
        establishment_id: establishment_id!,
        week_start,
        week_validated: false,
        validated_days: {},
      }).select("week_validated, validated_days, week_invalidated_at").single()
    );
    planningWeek = newWeek;
  }

  // ══════════════════════════════════════════════════════════════
  // AUTO-PUBLISH (uses cached establishment — no extra fetch!)
  // ══════════════════════════════════════════════════════════════
  const autoPublishEnabled = establishment.planning_auto_publish_enabled ?? false;
  const autoPublishTime = (establishment.planning_auto_publish_time || "20:00:00").slice(0, 5);
  const autoPublishActiveForThisWeek = autoPublishEnabled && isAutoPublishActive(week_start, autoPublishTime);

  const validation = {
    weekValidated: planningWeek?.week_validated || false,
    validatedDays: (planningWeek?.validated_days as Record<string, boolean>) || {},
    weekInvalidatedAt: planningWeek?.week_invalidated_at || null,
    autoPublishActive: autoPublishActiveForThisWeek && !planningWeek?.week_invalidated_at,
  };

  // ══════════════════════════════════════════════════════════════
  // DAY PARTS
  // ══════════════════════════════════════════════════════════════
  const requiredParts = ["morning", "midday", "evening"] as const;
  const dayParts: Record<string, { start_time: string; end_time: string; color: string }> = {};

  for (const dp of dayPartsData as Array<{ part: string; start_time: string; end_time: string; color: string }>) {
    if (dp.part === "morning" || dp.part === "midday" || dp.part === "evening") {
      dayParts[dp.part] = {
        start_time: formatTime(dp.start_time),
        end_time: formatTime(dp.end_time),
        color: dp.color,
      };
    }
  }

  const missingParts = requiredParts.filter(part => !dayParts[part]);
  if (missingParts.length > 0) {
    prof.flush();
    return { error: "Day parts not configured", status: 400 };
  }

  // ══════════════════════════════════════════════════════════════
  // OPENING HOURS (bulk — already fetched in Phase B)
  // ══════════════════════════════════════════════════════════════
  const openingByDate: Record<string, { open_time: string; close_time: string; isClosed: boolean }> = {};

  const exceptionsMap = new Map<string, { closed: boolean; open_time: string | null; close_time: string | null }>();
  for (const exc of exceptionsData as Array<{ date: string; closed: boolean; open_time: string | null; close_time: string | null }>) {
    exceptionsMap.set(exc.date, { closed: exc.closed, open_time: exc.open_time, close_time: exc.close_time });
  }

  const weeklyHoursMap = new Map<number, { closed: boolean; open_time: string | null; close_time: string | null }>();
  for (const wh of weeklyHoursData as Array<{ day_of_week: number; closed: boolean; open_time: string | null; close_time: string | null }>) {
    weeklyHoursMap.set(wh.day_of_week, { closed: wh.closed, open_time: wh.open_time, close_time: wh.close_time });
  }

  for (let i = 0; i < 7; i++) {
    const d = new Date(week_start + "T00:00:00");
    d.setDate(d.getDate() + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const jsDay = d.getDay();
    const dayOfWeek = jsDay === 0 ? 7 : jsDay;

    const exception = exceptionsMap.get(dateStr);
    const weeklyHrs = weeklyHoursMap.get(dayOfWeek);

    let openMin = 0;
    let closeMin = 24 * 60;
    let isClosed = false;

    if (exception) {
      if (exception.closed) { isClosed = true; }
      else if (exception.open_time && exception.close_time) {
        openMin = timeToMinutes(formatTime(exception.open_time));
        closeMin = normalizeEndMinutes(openMin, exception.close_time);
      }
    } else if (weeklyHrs) {
      if (weeklyHrs.closed) { isClosed = true; }
      else if (weeklyHrs.open_time && weeklyHrs.close_time) {
        openMin = timeToMinutes(formatTime(weeklyHrs.open_time));
        closeMin = normalizeEndMinutes(openMin, weeklyHrs.close_time);
      }
    }

    if (isClosed) {
      openingByDate[dateStr] = { open_time: "00:00", close_time: "00:00", isClosed: true };
    } else {
      const openHours = Math.floor(openMin / 60);
      const openMins = openMin % 60;
      const closeHours = Math.floor((closeMin % 1440) / 60);
      const closeMins = (closeMin % 1440) % 60;
      openingByDate[dateStr] = {
        open_time: `${String(openHours).padStart(2, "0")}:${String(openMins).padStart(2, "0")}`,
        close_time: `${String(closeHours).padStart(2, "0")}:${String(closeMins).padStart(2, "0")}`,
        isClosed: false,
      };
    }
  }

  // ══════════════════════════════════════════════════════════════
  // EMPLOYEE WEEK START (for self/team read-only scopes)
  // Uses cached establishment — no extra fetch
  // ══════════════════════════════════════════════════════════════
  let employeeWeekStart: string | null = null;

  const isEmployeeScope = planningScope === "self" || planningScope === "team";
  const isReadOnly = accessLevel === "read";

  if (isEmployeeScope && isReadOnly) {
    const todayParis = getTodayParis();
    const currentWeekMonday = getServiceDayMonday(todayParis);
    const nextWeekMonday = getNextWeekMonday(todayParis);

    let nextWeekVisible = false;

    const { data: nextWeekData } = await prof.time("next_week_check", () =>
      adminClient.from("planning_weeks")
        .select("week_validated, week_invalidated_at")
        .eq("establishment_id", establishment_id!)
        .eq("week_start", nextWeekMonday)
        .single()
    );

    if (nextWeekData?.week_invalidated_at) {
      nextWeekVisible = false;
    } else if (nextWeekData?.week_validated) {
      nextWeekVisible = true;
    } else if (autoPublishEnabled && isAutoPublishActive(nextWeekMonday, autoPublishTime)) {
      nextWeekVisible = true;
    }

    employeeWeekStart = nextWeekVisible ? nextWeekMonday : currentWeekMonday;
  }

  prof.flush();

  return {
    data: {
      weekStart: week_start,
      weekEnd,
      timezone: "Europe/Paris",
      establishment: { id: establishment.id, name: establishment.name },
      teams: teams.map(t => ({ id: t.id, name: t.name })),
      employees,
      shiftsByEmployee,
      totalsByEmployee,
      validation,
      dayParts,
      openingByDate,
      rextraByEmployeeByDate,
      rextraBalanceByEmployee,
      employeeWeekStart,
    },
    status: 200,
  };
}
