/**
 * Hook to fetch ALL absences for the current user (employee view)
 *
 * SSOT ALIGNED: Uses usePersonnelLeavesRange from planning as source of truth
 * for planned absences, ensuring "Mes absences" sees exactly what planning sees.
 *
 * Combines two sources:
 * 1. Planned absences: via usePersonnelLeavesRange (SSOT planning hook)
 * 2. Detected absences: planning_shifts without clock_in badge
 *
 * RULES:
 * - If a planned leave exists for a day, skip detected absence (anti-double counting)
 * - Read-only: employee cannot modify or delete
 * - Same logic for mobile and desktop
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { usePersonnelLeavesRange } from "@/hooks/personnel/usePersonnelLeaves";
import { timeToMinutes, getNowParisHHMM, normalizeToServiceDayTimeline } from "@/lib/time/paris";
import { getMonthBoundsParis } from "@/lib/time/dateKeyParis";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";
import type { UnifiedAbsenceRecord } from "../types";

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

export interface UseMyAllAbsencesOptions {
  /**
   * Month to display (YYYY-MM format) - REQUIRED
   */
  yearMonth: string;
}

export interface UseMyAllAbsencesResult {
  absences: UnifiedAbsenceRecord[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch all absences for current user for a specific month:
 * - Planned: via SSOT usePersonnelLeavesRange (same as planning)
 * - Detected: shifts without clock_in
 *
 * Returns unified list sorted by date (most recent first)
 */
export function useMyAllAbsences(options: UseMyAllAbsencesOptions): UseMyAllAbsencesResult {
  const { yearMonth } = options;
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id ?? null;

  // Get service day from RPC (SSOT)
  const { data: serviceDay } = useServiceDayToday(establishmentId ?? "");

  // Compute bounds from yearMonth using SSOT helper (timezone-safe)
  const { start, end } = getMonthBoundsParis(yearMonth);

  // ═══════════════════════════════════════════════════════════════════════════
  // SOURCE 1: Planned leaves via SSOT planning hook
  // This is the SAME hook used by planning - ensures perfect alignment
  // ═══════════════════════════════════════════════════════════════════════════
  const {
    data: allLeaves = [],
    isLoading: leavesLoading,
    error: leavesError,
    refetch: refetchLeaves,
  } = usePersonnelLeavesRange({
    establishmentId,
    dateFrom: start,
    dateTo: end,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SOURCE 2: Detected absences query (shifts without clock_in)
  // ═══════════════════════════════════════════════════════════════════════════
  const detectedQuery = useQuery({
    queryKey: ["my-detected-absences", establishmentId, yearMonth],
    queryFn: async (): Promise<UnifiedAbsenceRecord[]> => {
      if (!establishmentId) return [];

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const userId = user.id;

      // Fetch establishment's service_day_cutoff for overnight handling
      const { data: establishment } = await supabase
        .from("establishments")
        .select("service_day_cutoff")
        .eq("id", establishmentId)
        .single();

      const cutoffHHMM = establishment?.service_day_cutoff?.slice(0, 5) || "03:00";

      // Fetch user's shifts for the period
      const { data: shifts, error: shiftsError } = await supabase
        .from("planning_shifts")
        .select("id, shift_date, start_time, end_time")
        .eq("establishment_id", establishmentId)
        .eq("user_id", userId)
        .gte("shift_date", start)
        .lte("shift_date", end)
        .order("shift_date", { ascending: false })
        .order("start_time", { ascending: true });

      if (shiftsError) {
        throw new Error(`Failed to load shifts: ${shiftsError.message}`);
      }

      // Assign sequence_index per day
      const shiftsWithSeq: Array<{
        id: string;
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
              id: s.id,
              shift_date: s.shift_date,
              start_time: s.start_time,
              end_time: s.end_time,
              sequence_index: idx + 1,
            });
          });
        }
      }

      // Fetch ALL clock_in badge_events for the user
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

      // Find detected absent shifts (no clock_in AND shift finished)
      const todayServiceDay = serviceDay || "";
      const nowParisHHMM = getNowParisHHMM();
      const nowMin = normalizeToServiceDayTimeline(nowParisHHMM, cutoffHHMM);

      const detectedRecords: UnifiedAbsenceRecord[] = [];

      for (const s of shiftsWithSeq) {
        const clockInKey = `${s.shift_date}|${s.sequence_index}`;

        // Skip if has clock_in
        if (clockInSet.has(clockInKey)) continue;

        // Check if shift is finished
        let isFinished = false;

        if (s.shift_date < todayServiceDay) {
          isFinished = true; // Past day
        } else if (s.shift_date === todayServiceDay) {
          // Today: check if current time > end_time
          const startMin = normalizeToServiceDayTimeline(s.start_time.slice(0, 5), cutoffHHMM);
          let endMin = normalizeToServiceDayTimeline(s.end_time.slice(0, 5), cutoffHHMM);

          // Handle edge case: if end <= start after normalization, add 1440
          if (endMin <= startMin) {
            endMin += 1440;
          }

          isFinished = nowMin > endMin;
        }

        if (isFinished) {
          detectedRecords.push({
            id: `detected-${s.id}`,
            leave_date: s.shift_date,
            source: "detected",
            reason: null,
            has_justificatif: false,
            shift_start: s.start_time.slice(0, 5),
            shift_end: s.end_time.slice(0, 5),
            shift_minutes: computeShiftDuration(s.start_time, s.end_time),
          });
        }
      }

      return detectedRecords;
    },
    enabled: !!establishmentId && !!yearMonth,
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
    retry: false,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MERGE: Filter leaves for current user, combine with detected, sort
  // ═══════════════════════════════════════════════════════════════════════════
  const mergedAbsences = useQuery({
    queryKey: ["my-all-absences-merged", establishmentId, yearMonth, allLeaves, detectedQuery.data],
    queryFn: async (): Promise<UnifiedAbsenceRecord[]> => {
      // Get current user to filter leaves
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const userId = user.id;

      // Filter leaves for current user only — absences + AM only (CP has its own tab)
      const myLeaves = allLeaves.filter(
        (l) => l.user_id === userId && (l.leave_type === "absence" || l.leave_type === "am")
      );

      // Build set of days with approved leave (for anti-double counting)
      const plannedDays = new Set(myLeaves.map((l) => l.leave_date));

      // Convert to unified records (reason now comes from SSOT hook)
      const plannedRecords: UnifiedAbsenceRecord[] = myLeaves.map((l) => ({
        id: l.id,
        leave_date: l.leave_date,
        source: "planned" as const,
        leave_type: l.leave_type as "cp" | "absence" | "am",
        reason: l.reason,
        has_justificatif: false,
      }));

      // Get detected records, filtering out days with planned absences
      const detected = (detectedQuery.data || []).filter((d) => !plannedDays.has(d.leave_date));

      // Merge and sort (most recent first)
      const allRecords = [...plannedRecords, ...detected];
      allRecords.sort((a, b) => b.leave_date.localeCompare(a.leave_date));

      return allRecords;
    },
    enabled: !leavesLoading && !detectedQuery.isLoading,
    staleTime: 0, // Always recompute when deps change
  });

  // Combined loading state
  const isLoading = leavesLoading || detectedQuery.isLoading || mergedAbsences.isLoading;

  // Combined error
  const error = leavesError || detectedQuery.error || mergedAbsences.error;

  return {
    absences: mergedAbsences.data || [],
    isLoading,
    error: error as Error | null,
    refetch: () => {
      refetchLeaves();
      detectedQuery.refetch();
      mergedAbsences.refetch();
    },
  };
}
