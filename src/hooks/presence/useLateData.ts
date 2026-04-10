/**
 * Hook for fetching late (retard) and early departure (départ anticipé) data for admin view
 * V5.0: SSOT from DB - no more dynamic calculation
 *
 * Sources of truth (PHASE 1.4):
 * - Late arrival: badge_events.late_minutes (clock_in only) - stored value
 * - Early departure: badge_events.early_departure_minutes (clock_out only) - stored value
 *
 * Exclusions for early departure:
 * - Days with personnel_leaves (CP/Absence)
 * - Clock_outs with approved extra_events
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🛑 SSOT RULE: early_departure_minutes
 * ═══════════════════════════════════════════════════════════════════════════════
 * DO NOT recompute early departure on frontend!
 *
 * Source of Truth: badge_events.early_departure_minutes (DB column)
 * Computed by: badge-events Edge Function → checkEarlyDeparture()
 * Stored at: INSERT/UPDATE of clock_out event
 *
 * ❌ FORBIDDEN:
 *   - import { computeEarlyDeparture* } from any module
 *   - Dynamic calculation comparing clock_out.effective_at vs planning_shifts
 *   - Any frontend logic that recalculates early departure minutes
 *
 * ✅ ALLOWED:
 *   - SELECT early_departure_minutes FROM badge_events WHERE event_type = 'clock_out'
 *   - SUM(early_departure_minutes) for aggregations
 *
 * See: /docs/ssot-early-departure.md
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { formatParisHHMM } from "@/lib/time/paris";
// ❌ REMOVED: import { computeEarlyDepartureMinutes } - SSOT is now DB

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LateEventDetail {
  id: string;
  user_id: string;
  day_date: string;
  late_minutes: number;
  occurred_at: string;
  effective_at: string;
  sequence_index: number;
}

export interface EarlyDepartureEventDetail {
  id: string;
  user_id: string;
  day_date: string;
  early_minutes: number; // DERIVED, never stored
  planned_end: string; // HH:mm
  actual_departure: string; // HH:mm
  sequence_index: number;
}

export interface TimingEventDetail {
  id: string;
  user_id: string;
  day_date: string;
  late_minutes: number;
  early_departure_minutes: number;
  sequence_index: number;
  // For display (SSOT from planning_shifts)
  planned_start?: string; // HH:mm
  planned_end?: string; // HH:mm
  // For display (from badge_events)
  occurred_at?: string;
  effective_at?: string;
  actual_departure?: string;
}

export interface LateEmployeeSummary {
  userId: string;
  fullName: string;
  totalLateMinutes: number;
  totalEarlyDepartureMinutes: number;
  lateCount: number; // number of days with late arrival
  earlyDepartureCount: number; // number of days with early departure
}

export interface UseLateDataResult {
  summaries: LateEmployeeSummary[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ❌ REMOVED: calculateEarlyDeparture helper - SSOT is now DB

// ─────────────────────────────────────────────────────────────────────────────
// Monthly Summary Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch monthly late + early departure summaries by employee
 * @param yearMonth - YYYY-MM format
 * @param params - Optional override for establishmentId (used by desktop admin)
 */
export function useLateMonthlyData(
  yearMonth: string,
  params?: { establishmentId?: string | null }
): UseLateDataResult {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = params?.establishmentId ?? activeEstablishment?.id;

  const query = useQuery({
    queryKey: ["late", "monthly", establishmentId, yearMonth],
    queryFn: async (): Promise<LateEmployeeSummary[]> => {
      if (!establishmentId) return [];

      const { start, end } = getMonthBounds(yearMonth);

      // ───────────────────────────────────────────────────────────────────
      // 1. Fetch late arrivals (badge_events with late_minutes > 0)
      // ───────────────────────────────────────────────────────────────────
      const { data: lateEvents, error: lateError } = await supabase
        .from("badge_events")
        .select("id, user_id, day_date, late_minutes")
        .eq("establishment_id", establishmentId)
        .eq("event_type", "clock_in")
        .gt("late_minutes", 0)
        .gte("day_date", start)
        .lte("day_date", end);

      if (lateError) {
        throw new Error(`Failed to load late events: ${lateError.message}`);
      }

      // ───────────────────────────────────────────────────────────────────
      // 2. Fetch planning_shifts for the period (needed for early departure calc)
      // ───────────────────────────────────────────────────────────────────
      const { data: shifts, error: shiftsError } = await supabase
        .from("planning_shifts")
        .select("user_id, shift_date, start_time, end_time")
        .eq("establishment_id", establishmentId)
        .gte("shift_date", start)
        .lte("shift_date", end);

      if (shiftsError) {
        throw new Error(`Failed to load shifts: ${shiftsError.message}`);
      }

      // ───────────────────────────────────────────────────────────────────
      // 3. Fetch clock_out events for the period
      // PHASE 1.4 SSOT: Include early_departure_minutes from DB
      // ───────────────────────────────────────────────────────────────────
      const { data: clockOuts, error: clockOutsError } = await supabase
        .from("badge_events")
        .select("id, user_id, day_date, effective_at, sequence_index, early_departure_minutes")
        .eq("establishment_id", establishmentId)
        .eq("event_type", "clock_out")
        .gte("day_date", start)
        .lte("day_date", end);

      if (clockOutsError) {
        throw new Error(`Failed to load clock_out events: ${clockOutsError.message}`);
      }

      // ───────────────────────────────────────────────────────────────────
      // 4. Fetch personnel_leaves to exclude CP/Absence days
      // ───────────────────────────────────────────────────────────────────
      const { data: leaves, error: leavesError } = await supabase
        .from("personnel_leaves")
        .select("user_id, leave_date")
        .eq("establishment_id", establishmentId)
        .eq("status", "approved")
        .gte("leave_date", start)
        .lte("leave_date", end);

      if (leavesError) {
        throw new Error(`Failed to load leaves: ${leavesError.message}`);
      }

      // Build leave set for exclusion
      const leaveSet = new Set((leaves || []).map((l) => `${l.user_id}|${l.leave_date}`));

      // ───────────────────────────────────────────────────────────────────
      // 4b. Fetch approved extra_events to exclude from early departure
      // If a clock_out has an approved extra, it's NOT an early departure
      // ───────────────────────────────────────────────────────────────────
      const { data: approvedExtras, error: extrasError } = await supabase
        .from("extra_events")
        .select("badge_event_id")
        .eq("establishment_id", establishmentId)
        .eq("status", "approved")
        .gte("day_date", start)
        .lte("day_date", end);

      if (extrasError) {
        throw new Error(`Failed to load extra events: ${extrasError.message}`);
      }

      // Build set of clock_out IDs that have approved extras
      const approvedExtraEventIds = new Set((approvedExtras || []).map((e) => e.badge_event_id));

      // ───────────────────────────────────────────────────────────────────
      // 5. Build shifts map with sequence index
      // IMPORTANT: sequence_index in badge_events matches the order of shifts by start_time
      // ───────────────────────────────────────────────────────────────────
      const shiftsByUserDay = new Map<
        string,
        Array<{ start_time: string; end_time: string; seq: number }>
      >();
      for (const s of shifts || []) {
        const key = `${s.user_id}|${s.shift_date}`;
        const existing = shiftsByUserDay.get(key) || [];
        existing.push({ start_time: s.start_time, end_time: s.end_time, seq: 0 }); // seq assigned after sort
        shiftsByUserDay.set(key, existing);
      }

      // Sort by start_time FIRST, then assign sequence 1, 2, 3...
      for (const [, dayShifts] of shiftsByUserDay) {
        dayShifts.sort((a, b) => a.start_time.localeCompare(b.start_time));
        dayShifts.forEach((s, idx) => {
          s.seq = idx + 1;
        });
      }

      // ───────────────────────────────────────────────────────────────────
      // 6. Read early departures from DB (PHASE 1.4 SSOT)
      // ❌ NO MORE RECALCULATION - DB is the single source of truth
      // ───────────────────────────────────────────────────────────────────
      interface EarlyDepartureData {
        userId: string;
        dayDate: string;
        earlyMinutes: number;
      }
      const earlyDepartures: EarlyDepartureData[] = [];

      for (const clockOut of clockOuts || []) {
        // Skip if no early departure stored
        if (!clockOut.early_departure_minutes || clockOut.early_departure_minutes <= 0) continue;

        const userDayKey = `${clockOut.user_id}|${clockOut.day_date}`;

        // Skip if day has leave
        if (leaveSet.has(userDayKey)) continue;

        // Skip if this clock_out has an approved extra (not an early departure for payroll)
        if (approvedExtraEventIds.has(clockOut.id)) continue;

        earlyDepartures.push({
          userId: clockOut.user_id,
          dayDate: clockOut.day_date,
          earlyMinutes: clockOut.early_departure_minutes,
        });
      }

      // ───────────────────────────────────────────────────────────────────
      // 7. Aggregate by user
      // ───────────────────────────────────────────────────────────────────
      const userAggregates = new Map<
        string,
        {
          lateTotalMinutes: number;
          lateDays: Set<string>;
          earlyTotalMinutes: number;
          earlyDays: Set<string>;
        }
      >();

      // Process late arrivals
      for (const event of lateEvents || []) {
        const current = userAggregates.get(event.user_id) || {
          lateTotalMinutes: 0,
          lateDays: new Set<string>(),
          earlyTotalMinutes: 0,
          earlyDays: new Set<string>(),
        };
        current.lateTotalMinutes += event.late_minutes || 0;
        current.lateDays.add(event.day_date);
        userAggregates.set(event.user_id, current);
      }

      // Process early departures
      for (const ed of earlyDepartures) {
        const current = userAggregates.get(ed.userId) || {
          lateTotalMinutes: 0,
          lateDays: new Set<string>(),
          earlyTotalMinutes: 0,
          earlyDays: new Set<string>(),
        };
        current.earlyTotalMinutes += ed.earlyMinutes;
        current.earlyDays.add(ed.dayDate);
        userAggregates.set(ed.userId, current);
      }

      // If no data at all, return empty
      if (userAggregates.size === 0) {
        return [];
      }

      // ───────────────────────────────────────────────────────────────────
      // 8. Fetch profiles for names
      // ───────────────────────────────────────────────────────────────────
      const userIds = [...userAggregates.keys()];
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

      // ───────────────────────────────────────────────────────────────────
      // 9. Build summaries
      // ───────────────────────────────────────────────────────────────────
      const summaries: LateEmployeeSummary[] = [];
      for (const [userId, agg] of userAggregates) {
        summaries.push({
          userId,
          fullName: profilesMap.get(userId) || "Inconnu",
          totalLateMinutes: agg.lateTotalMinutes,
          totalEarlyDepartureMinutes: agg.earlyTotalMinutes,
          lateCount: agg.lateDays.size,
          earlyDepartureCount: agg.earlyDays.size,
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

// ─────────────────────────────────────────────────────────────────────────────
// Employee Detail Hook
// ─────────────────────────────────────────────────────────────────────────────

export interface UseLateDetailResult {
  events: TimingEventDetail[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch late + early departure events detail for a specific employee in a month
 */
export function useLateEmployeeDetail(
  userId: string | null,
  yearMonth: string,
  params?: { establishmentId?: string | null }
): UseLateDetailResult {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = params?.establishmentId ?? activeEstablishment?.id;

  const query = useQuery({
    queryKey: ["late", "detail", establishmentId, userId, yearMonth],
    queryFn: async (): Promise<TimingEventDetail[]> => {
      if (!establishmentId || !userId) return [];

      const { start, end } = getMonthBounds(yearMonth);

      // ───────────────────────────────────────────────────────────────────
      // 1. Fetch late arrivals for this user
      // ───────────────────────────────────────────────────────────────────
      const { data: lateEvents, error: lateError } = await supabase
        .from("badge_events")
        .select("id, user_id, day_date, late_minutes, occurred_at, effective_at, sequence_index")
        .eq("establishment_id", establishmentId)
        .eq("user_id", userId)
        .eq("event_type", "clock_in")
        .gt("late_minutes", 0)
        .gte("day_date", start)
        .lte("day_date", end)
        .order("day_date", { ascending: true })
        .order("sequence_index", { ascending: true });

      if (lateError) {
        throw new Error(`Failed to load late detail: ${lateError.message}`);
      }

      // ───────────────────────────────────────────────────────────────────
      // 2. Fetch clock_out events for this user
      // PHASE 1.4 SSOT: Include early_departure_minutes from DB
      // ───────────────────────────────────────────────────────────────────
      const { data: clockOuts, error: clockOutsError } = await supabase
        .from("badge_events")
        .select("id, user_id, day_date, effective_at, sequence_index, early_departure_minutes")
        .eq("establishment_id", establishmentId)
        .eq("user_id", userId)
        .eq("event_type", "clock_out")
        .gte("day_date", start)
        .lte("day_date", end);

      if (clockOutsError) {
        throw new Error(`Failed to load clock_out events: ${clockOutsError.message}`);
      }

      // ───────────────────────────────────────────────────────────────────
      // 3. Fetch shifts for this user
      // ───────────────────────────────────────────────────────────────────
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

      // ───────────────────────────────────────────────────────────────────
      // 4. Fetch leaves for this user (to exclude)
      // ───────────────────────────────────────────────────────────────────
      const { data: leaves, error: leavesError } = await supabase
        .from("personnel_leaves")
        .select("user_id, leave_date")
        .eq("establishment_id", establishmentId)
        .eq("user_id", userId)
        .eq("status", "approved")
        .gte("leave_date", start)
        .lte("leave_date", end);

      if (leavesError) {
        throw new Error(`Failed to load leaves: ${leavesError.message}`);
      }

      const leaveSet = new Set((leaves || []).map((l) => l.leave_date));

      // ───────────────────────────────────────────────────────────────────
      // 4b. Fetch approved extra_events for this user (to exclude from early departure)
      // ───────────────────────────────────────────────────────────────────
      const { data: approvedExtras, error: extrasError } = await supabase
        .from("extra_events")
        .select("badge_event_id")
        .eq("establishment_id", establishmentId)
        .eq("user_id", userId)
        .eq("status", "approved")
        .gte("day_date", start)
        .lte("day_date", end);

      if (extrasError) {
        throw new Error(`Failed to load extra events: ${extrasError.message}`);
      }

      const approvedExtraEventIds = new Set((approvedExtras || []).map((e) => e.badge_event_id));

      // Build shifts map with sequence
      // IMPORTANT: sequence_index in badge_events matches the order of shifts by start_time
      const shiftsByDay = new Map<
        string,
        Array<{ start_time: string; end_time: string; seq: number }>
      >();
      for (const s of shifts || []) {
        const existing = shiftsByDay.get(s.shift_date) || [];
        existing.push({ start_time: s.start_time, end_time: s.end_time, seq: 0 }); // seq assigned after sort
        shiftsByDay.set(s.shift_date, existing);
      }

      // Sort by start_time FIRST, then assign sequence 1, 2, 3...
      for (const [, dayShifts] of shiftsByDay) {
        dayShifts.sort((a, b) => a.start_time.localeCompare(b.start_time));
        dayShifts.forEach((s, idx) => {
          s.seq = idx + 1;
        });
      }

      // ───────────────────────────────────────────────────────────────────
      // 5. Build combined events map by day|seq
      // ───────────────────────────────────────────────────────────────────
      const eventsMap = new Map<string, TimingEventDetail>();

      // Add late arrivals
      for (const e of lateEvents || []) {
        const key = `${e.day_date}|${e.sequence_index}`;
        // Get matching shift for planned times (SSOT)
        const dayShifts = shiftsByDay.get(e.day_date);
        const matchingShift = dayShifts?.find((s) => s.seq === e.sequence_index) || dayShifts?.[0];

        eventsMap.set(key, {
          id: e.id,
          user_id: e.user_id,
          day_date: e.day_date,
          late_minutes: e.late_minutes || 0,
          early_departure_minutes: 0,
          sequence_index: e.sequence_index,
          occurred_at: e.occurred_at,
          effective_at: e.effective_at,
          // SSOT: shift times from planning_shifts
          planned_start: matchingShift?.start_time.slice(0, 5),
          planned_end: matchingShift?.end_time.slice(0, 5),
        });
      }

      // Add early departures (PHASE 1.4 SSOT: read from DB)
      for (const clockOut of clockOuts || []) {
        // Skip if no early departure stored
        if (!clockOut.early_departure_minutes || clockOut.early_departure_minutes <= 0) continue;

        // Skip if leave day
        if (leaveSet.has(clockOut.day_date)) continue;

        // Skip if this clock_out has an approved extra (not an early departure)
        if (approvedExtraEventIds.has(clockOut.id)) continue;

        const dayShifts = shiftsByDay.get(clockOut.day_date);
        const matchingShift =
          dayShifts?.find((s) => s.seq === clockOut.sequence_index) || dayShifts?.[0];
        const earlyMinutes = clockOut.early_departure_minutes;

        const key = `${clockOut.day_date}|${clockOut.sequence_index}`;
        const existing = eventsMap.get(key);

        if (existing) {
          // Merge with existing late arrival
          existing.early_departure_minutes = earlyMinutes;
          existing.planned_end = matchingShift?.end_time.slice(0, 5);
          existing.actual_departure = formatParisHHMM(clockOut.effective_at);
        } else {
          // New entry for early departure only
          eventsMap.set(key, {
            id: clockOut.id,
            user_id: clockOut.user_id,
            day_date: clockOut.day_date,
            late_minutes: 0,
            early_departure_minutes: earlyMinutes,
            sequence_index: clockOut.sequence_index,
            planned_end: matchingShift?.end_time.slice(0, 5),
            actual_departure: formatParisHHMM(clockOut.effective_at),
          });
        }
      }

      // Convert to array and sort
      const result = Array.from(eventsMap.values());
      result.sort((a, b) => {
        const dateCompare = a.day_date.localeCompare(b.day_date);
        if (dateCompare !== 0) return dateCompare;
        return a.sequence_index - b.sequence_index;
      });

      return result;
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
