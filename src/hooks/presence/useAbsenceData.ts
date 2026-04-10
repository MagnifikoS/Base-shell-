/**
 * Hook for fetching absence data for admin view
 * V5: SINGLE SOURCE OF TRUTH - Uses get_service_day RPC, no local date calculation
 *
 * Combines two sources:
 *   1. Planned leaves from personnel_leaves (approved) - CP/Absence marqués dans Planning
 *   2. Derived absences from planning_shifts + badge_events (shift fini sans clock_in)
 * Anti-double counting: if a leave exists for user/day, skip derived absence for that day
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { timeToMinutes, getNowParisHHMM, normalizeToServiceDayTimeline } from "@/lib/time/paris";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";

export interface AbsenceEvent {
  userId: string;
  fullName: string;
  dayDate: string;
  sequenceIndex: number;
  plannedStart: string;
  plannedEnd: string;
  plannedMinutes: number;
  absenceType: "leave" | "undeclared"; // NEW: distinguish source
  leaveType?: "cp" | "absence"; // Only for leave type
}

export interface AbsenceEmployeeSummary {
  userId: string;
  fullName: string;
  totalAbsenceMinutes: number;
  absenceCount: number; // number of shifts/leaves
  leaveCount: number; // planned leaves (CP/Absence)
  undeclaredCount: number; // derived absences (no clock_in)
}

export interface UseAbsenceDataResult {
  summaries: AbsenceEmployeeSummary[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Get first and last day of a month (YYYY-MM format)
 */
function getMonthBounds(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

/**
 * Compute shift duration in minutes
 */
function computeShiftDuration(startTime: string, endTime: string): number {
  const startMin = timeToMinutes(startTime.slice(0, 5));
  const endMin = timeToMinutes(endTime.slice(0, 5));
  // Handle overnight shifts
  if (endMin < startMin) {
    return 1440 - startMin + endMin;
  }
  return endMin - startMin;
}

/**
 * Fetch monthly absence summaries by employee
 * Combines: personnel_leaves (approved) + derived absences (shifts without clock_in)
 * @param yearMonth - YYYY-MM format
 * @param params - Optional override for establishmentId (used by desktop admin)
 *
 * ✅ V5: Uses get_service_day RPC via useServiceDayToday - NO local date calculation
 */
export function useAbsenceMonthlyData(
  yearMonth: string,
  params?: { establishmentId?: string | null }
): UseAbsenceDataResult {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = params?.establishmentId ?? activeEstablishment?.id;

  // ✅ SINGLE SOURCE OF TRUTH: Get service day from RPC
  const { data: serviceDay } = useServiceDayToday(establishmentId ?? "");

  const query = useQuery({
    queryKey: ["absence", "monthly", establishmentId, yearMonth],
    queryFn: async (): Promise<AbsenceEmployeeSummary[]> => {
      if (!establishmentId) return [];

      // ═══════════════════════════════════════════════════════════════════════
      // SSOT: Fetch establishment's service_day_cutoff for overnight handling
      // ═══════════════════════════════════════════════════════════════════════
      const { data: establishment } = await supabase
        .from("establishments")
        .select("service_day_cutoff")
        .eq("id", establishmentId)
        .single();

      const cutoffHHMM = establishment?.service_day_cutoff?.slice(0, 5) || "03:00";

      const { start, end } = getMonthBounds(yearMonth);

      // ═══════════════════════════════════════════════════════════════════════
      // SOURCE 1: Planned leaves from personnel_leaves (approved cp/absence only)
      // EXCLUDE repos - repos is not counted as absence
      // ═══════════════════════════════════════════════════════════════════════
      const { data: leaves, error: leavesError } = await supabase
        .from("personnel_leaves")
        .select("user_id, leave_date, leave_type")
        .eq("establishment_id", establishmentId)
        .eq("status", "approved")
        .eq("leave_type", "absence") // Only absences, exclude CP and repos
        .gte("leave_date", start)
        .lte("leave_date", end);

      if (leavesError) {
        throw new Error(`Failed to load leaves: ${leavesError.message}`);
      }

      // Build set of user|day with approved leave (for anti-double counting)
      const leaveSet = new Set((leaves || []).map((l) => `${l.user_id}|${l.leave_date}`));

      // ═══════════════════════════════════════════════════════════════════════
      // SOURCE 2: Derived absences (planning_shifts without clock_in)
      // ═══════════════════════════════════════════════════════════════════════
      const { data: shifts, error: shiftsError } = await supabase
        .from("planning_shifts")
        .select("user_id, shift_date, start_time, end_time")
        .eq("establishment_id", establishmentId)
        .gte("shift_date", start)
        .lte("shift_date", end)
        .order("shift_date", { ascending: true })
        .order("start_time", { ascending: true });

      if (shiftsError) {
        throw new Error(`Failed to load shifts: ${shiftsError.message}`);
      }

      // Assign sequence_index per user per day
      const shiftsWithSeq: Array<{
        user_id: string;
        shift_date: string;
        start_time: string;
        end_time: string;
        sequence_index: number;
      }> = [];

      if (shifts && shifts.length > 0) {
        const shiftsByUserDay = new Map<string, typeof shifts>();
        for (const s of shifts) {
          const key = `${s.user_id}|${s.shift_date}`;
          const existing = shiftsByUserDay.get(key) || [];
          existing.push(s);
          shiftsByUserDay.set(key, existing);
        }

        for (const [, dayShifts] of shiftsByUserDay) {
          dayShifts.sort((a, b) => a.start_time.localeCompare(b.start_time));
          dayShifts.forEach((s, idx) => {
            shiftsWithSeq.push({ ...s, sequence_index: idx + 1 });
          });
        }
      }

      // Fetch ALL clock_in badge_events for the period
      const { data: clockIns, error: clockInsError } = await supabase
        .from("badge_events")
        .select("user_id, day_date, sequence_index")
        .eq("establishment_id", establishmentId)
        .eq("event_type", "clock_in")
        .gte("day_date", start)
        .lte("day_date", end);

      if (clockInsError) {
        throw new Error(`Failed to load badge events: ${clockInsError.message}`);
      }

      const clockInSet = new Set(
        (clockIns || []).map((e) => `${e.user_id}|${e.day_date}|${e.sequence_index}`)
      );

      // Find derived absent shifts (no clock_in AND shift finished AND no leave for that day)
      // ✅ V5: Use service day from RPC, not local date
      // ✅ V6: Use service_day_cutoff (SSOT) for overnight handling
      const todayServiceDay = serviceDay || "";
      const nowParisHHMM = getNowParisHHMM();
      const nowMin = normalizeToServiceDayTimeline(nowParisHHMM, cutoffHHMM);

      const absentShifts = shiftsWithSeq.filter((s) => {
        const clockInKey = `${s.user_id}|${s.shift_date}|${s.sequence_index}`;
        const leaveKey = `${s.user_id}|${s.shift_date}`;

        // Skip if has clock_in
        if (clockInSet.has(clockInKey)) return false;

        // Skip if a leave exists for this user/day (anti-double counting)
        if (leaveSet.has(leaveKey)) return false;

        // Check if shift is finished - using service day from RPC
        if (s.shift_date < todayServiceDay) {
          return true; // Past day
        } else if (s.shift_date === todayServiceDay) {
          // Today: check if current time > end_time using SSOT cutoff
          const startMin = normalizeToServiceDayTimeline(s.start_time.slice(0, 5), cutoffHHMM);
          let endMin = normalizeToServiceDayTimeline(s.end_time.slice(0, 5), cutoffHHMM);

          // Handle edge case: if end <= start after normalization, add 1440
          if (endMin <= startMin) {
            endMin += 1440;
          }

          return nowMin > endMin;
        } else {
          return false; // Future
        }
      });

      // ═══════════════════════════════════════════════════════════════════════
      // AGGREGATE: Combine leaves + derived absences
      // ═══════════════════════════════════════════════════════════════════════
      const userAggregates = new Map<
        string,
        { totalMinutes: number; leaveCount: number; undeclaredCount: number }
      >();

      // Add leaves (assume 8h = 480min per leave day, can be adjusted)
      for (const leave of leaves || []) {
        const current = userAggregates.get(leave.user_id) || {
          totalMinutes: 0,
          leaveCount: 0,
          undeclaredCount: 0,
        };
        current.totalMinutes += 480; // Default 8h per leave
        current.leaveCount += 1;
        userAggregates.set(leave.user_id, current);
      }

      // Add derived absences
      for (const shift of absentShifts) {
        const duration = computeShiftDuration(shift.start_time, shift.end_time);
        const current = userAggregates.get(shift.user_id) || {
          totalMinutes: 0,
          leaveCount: 0,
          undeclaredCount: 0,
        };
        current.totalMinutes += duration;
        current.undeclaredCount += 1;
        userAggregates.set(shift.user_id, current);
      }

      if (userAggregates.size === 0) {
        return [];
      }

      // Get unique user IDs
      const userIds = [...userAggregates.keys()];

      // Fetch profiles
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      if (profilesError) {
        throw new Error(`Failed to load profiles: ${profilesError.message}`);
      }

      const profilesMap = new Map(
        (profiles || []).map((p) => [p.user_id, p.full_name || "Inconnu"])
      );

      // Build summaries
      const summaries: AbsenceEmployeeSummary[] = [];
      for (const [userId, agg] of userAggregates) {
        summaries.push({
          userId,
          fullName: profilesMap.get(userId) || "Inconnu",
          totalAbsenceMinutes: agg.totalMinutes,
          absenceCount: agg.leaveCount + agg.undeclaredCount,
          leaveCount: agg.leaveCount,
          undeclaredCount: agg.undeclaredCount,
        });
      }

      // Sort by name
      summaries.sort((a, b) => a.fullName.localeCompare(b.fullName));

      return summaries;
    },
    enabled: !!establishmentId && !!yearMonth,
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
  });

  return {
    summaries: query.data || [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

/**
 * Fetch absence detail for a specific employee in a month
 * Combines: personnel_leaves (approved) + derived absences (shifts without clock_in)
 */
export interface UseAbsenceDetailResult {
  events: AbsenceEvent[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useAbsenceEmployeeDetail(
  userId: string | null,
  yearMonth: string,
  params?: { establishmentId?: string | null }
): UseAbsenceDetailResult {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = params?.establishmentId ?? activeEstablishment?.id;

  const query = useQuery({
    queryKey: ["absence", "detail", establishmentId, userId, yearMonth],
    queryFn: async (): Promise<AbsenceEvent[]> => {
      if (!establishmentId || !userId) return [];

      // ═══════════════════════════════════════════════════════════════════════
      // SSOT: Fetch establishment's service_day_cutoff for overnight handling
      // ═══════════════════════════════════════════════════════════════════════
      const { data: establishment } = await supabase
        .from("establishments")
        .select("service_day_cutoff")
        .eq("id", establishmentId)
        .single();

      const cutoffHHMM = establishment?.service_day_cutoff?.slice(0, 5) || "03:00";

      const { start, end } = getMonthBounds(yearMonth);

      // Get profile for name first
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", userId)
        .single();

      const fullName = profile?.full_name || "Inconnu";

      // ═══════════════════════════════════════════════════════════════════════
      // SOURCE 1: Planned leaves from personnel_leaves (approved cp/absence only)
      // EXCLUDE repos - repos is not counted as absence
      // ═══════════════════════════════════════════════════════════════════════
      const { data: leaves, error: leavesError } = await supabase
        .from("personnel_leaves")
        .select("leave_date, leave_type")
        .eq("establishment_id", establishmentId)
        .eq("user_id", userId)
        .eq("status", "approved")
        .eq("leave_type", "absence") // Only absences, exclude CP and repos
        .gte("leave_date", start)
        .lte("leave_date", end)
        .order("leave_date", { ascending: true });

      if (leavesError) {
        throw new Error(`Failed to load leaves: ${leavesError.message}`);
      }

      // Build set of days with approved leave (for anti-double counting)
      const leaveSet = new Set((leaves || []).map((l) => l.leave_date));

      // Build leave events
      const leaveEvents: AbsenceEvent[] = (leaves || []).map((l) => ({
        userId,
        fullName,
        dayDate: l.leave_date,
        sequenceIndex: 0, // Leaves don't have sequence
        plannedStart: "00:00",
        plannedEnd: "00:00",
        plannedMinutes: 480, // Default 8h
        absenceType: "leave" as const,
        leaveType: l.leave_type as "cp" | "absence",
      }));

      // ═══════════════════════════════════════════════════════════════════════
      // SOURCE 2: Derived absences (planning_shifts without clock_in)
      // ═══════════════════════════════════════════════════════════════════════
      const { data: shifts, error: shiftsError } = await supabase
        .from("planning_shifts")
        .select("user_id, shift_date, start_time, end_time")
        .eq("establishment_id", establishmentId)
        .eq("user_id", userId)
        .gte("shift_date", start)
        .lte("shift_date", end)
        .order("shift_date", { ascending: true })
        .order("start_time", { ascending: true });

      if (shiftsError) {
        throw new Error(`Failed to load shifts: ${shiftsError.message}`);
      }

      // Assign sequence_index per day
      const shiftsWithSeq: Array<{
        shift_date: string;
        start_time: string;
        end_time: string;
        sequence_index: number;
      }> = [];

      if (shifts && shifts.length > 0) {
        const shiftsByDay = new Map<string, typeof shifts>();
        for (const s of shifts) {
          const existing = shiftsByDay.get(s.shift_date) || [];
          existing.push(s);
          shiftsByDay.set(s.shift_date, existing);
        }

        for (const [, dayShifts] of shiftsByDay) {
          dayShifts.sort((a, b) => a.start_time.localeCompare(b.start_time));
          dayShifts.forEach((s, idx) => {
            shiftsWithSeq.push({
              shift_date: s.shift_date,
              start_time: s.start_time,
              end_time: s.end_time,
              sequence_index: idx + 1,
            });
          });
        }
      }

      // Fetch clock_ins for this user
      const { data: clockIns, error: clockInsError } = await supabase
        .from("badge_events")
        .select("day_date, sequence_index")
        .eq("establishment_id", establishmentId)
        .eq("user_id", userId)
        .eq("event_type", "clock_in")
        .gte("day_date", start)
        .lte("day_date", end);

      if (clockInsError) {
        throw new Error(`Failed to load badge events: ${clockInsError.message}`);
      }

      const clockInSet = new Set((clockIns || []).map((e) => `${e.day_date}|${e.sequence_index}`));

      // ✅ V5: Must fetch service day from RPC for this user's establishment
      // ✅ V6: Use service_day_cutoff (SSOT) for overnight handling
      const { data: serviceDayData } = await supabase.rpc("get_service_day_now", {
        _establishment_id: establishmentId,
      });
      const todayServiceDay = serviceDayData || "";
      const nowParisHHMM = getNowParisHHMM();
      const nowMin = normalizeToServiceDayTimeline(nowParisHHMM, cutoffHHMM);

      // Find derived absent shifts (no clock_in AND shift finished AND no leave for that day)
      const absentShifts = shiftsWithSeq.filter((s) => {
        const clockInKey = `${s.shift_date}|${s.sequence_index}`;

        // Skip if has clock_in
        if (clockInSet.has(clockInKey)) return false;

        // Skip if a leave exists for this day (anti-double counting)
        if (leaveSet.has(s.shift_date)) return false;

        // Check if shift is finished - using service day from RPC and SSOT cutoff
        if (s.shift_date < todayServiceDay) {
          return true;
        } else if (s.shift_date === todayServiceDay) {
          const startMin = normalizeToServiceDayTimeline(s.start_time.slice(0, 5), cutoffHHMM);
          let endMin = normalizeToServiceDayTimeline(s.end_time.slice(0, 5), cutoffHHMM);

          // Handle edge case: if end <= start after normalization, add 1440
          if (endMin <= startMin) {
            endMin += 1440;
          }

          return nowMin > endMin;
        } else {
          return false;
        }
      });

      // Build derived absence events
      const undeclaredEvents: AbsenceEvent[] = absentShifts.map((s) => ({
        userId,
        fullName,
        dayDate: s.shift_date,
        sequenceIndex: s.sequence_index,
        plannedStart: s.start_time.slice(0, 5),
        plannedEnd: s.end_time.slice(0, 5),
        plannedMinutes: computeShiftDuration(s.start_time, s.end_time),
        absenceType: "undeclared" as const,
      }));

      // ═══════════════════════════════════════════════════════════════════════
      // COMBINE and sort by date
      // ═══════════════════════════════════════════════════════════════════════
      const allEvents = [...leaveEvents, ...undeclaredEvents];
      allEvents.sort((a, b) => a.dayDate.localeCompare(b.dayDate));

      return allEvents;
    },
    enabled: !!establishmentId && !!userId && !!yearMonth,
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
  });

  return {
    events: query.data || [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
