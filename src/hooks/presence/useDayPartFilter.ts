/**
 * Hook for filtering employees by day part (morning/midday/evening)
 * Uses establishment day_parts configuration as SINGLE SOURCE OF TRUTH
 * V1: Pure filter logic, auto-selects current period on mount
 */

import { useMemo } from "react";
import { useDayPartsNormalized } from "@/components/establishments/hours/hooks/useDayParts";
import { getNowParisHHMM, timeToMinutes } from "@/lib/time/paris";
import type { DayPartsNormalized } from "@/components/establishments/hours/types/establishment-hours.types";
import type { PresenceEmployeeCard, PresenceSession } from "@/lib/presence/presence.compute";

export type DayPartKey = "morning" | "midday" | "evening" | "all";

export interface DayPartOption {
  key: DayPartKey;
  label: string;
  startTime: string;
  endTime: string;
  color: string;
}

/**
 * Check if a session overlaps with a day part time range
 * A shift overlaps if:
 * - Session start < part end AND session end > part start
 * 
 * V3 SSOT: Uses the actual partEnd from day_parts config (no hardcode).
 * For overnight parts (end < start, e.g., 18:00-03:00), normalizes times correctly.
 */
function sessionOverlapsPart(
  session: PresenceSession, 
  partStart: string, 
  partEnd: string
): boolean {
  const partStartMin = timeToMinutes(partStart);
  let partEndMin = timeToMinutes(partEnd);
  
  // Handle overnight part (e.g., 18:00 - 03:00)
  const isOvernightPart = partEndMin <= partStartMin;
  if (isOvernightPart) {
    partEndMin += 1440;
  }

  // Handle badge_only sessions (plannedStart/End = "--:--")
  if (session.plannedStart === "--:--") {
    if (!session.clockIn) return false;
    let clockInMin = timeToMinutes(session.clockIn);
    
    // Normalize clock-in for overnight parts (e.g., 01:00 → 1441)
    if (isOvernightPart && clockInMin < partStartMin) {
      clockInMin += 1440;
    }
    
    return clockInMin >= partStartMin && clockInMin < partEndMin;
  }

  let sessionStartMin = timeToMinutes(session.plannedStart);
  let sessionEndMin = timeToMinutes(session.plannedEnd);

  // Handle overnight sessions (e.g., 01:00-01:15)
  if (sessionEndMin <= sessionStartMin) {
    sessionEndMin += 1440;
  }

  // Normalize session times for overnight parts
  if (isOvernightPart && sessionStartMin < partStartMin) {
    sessionStartMin += 1440;
    sessionEndMin += 1440;
  }

  // Overlap check
  return sessionStartMin < partEndMin && sessionEndMin > partStartMin;
}

/**
 * Get the current day part based on now time
 */
export function getCurrentDayPart(dayParts: DayPartsNormalized): DayPartKey {
  const nowHHMM = getNowParisHHMM();
  const nowMin = timeToMinutes(nowHHMM);

  // Check each part in order: morning, midday, evening
  const parts: Array<{ key: DayPartKey; data: { start: string; end: string } | null }> = [
    { key: "morning", data: dayParts.morning },
    { key: "midday", data: dayParts.midday },
    { key: "evening", data: dayParts.evening },
  ];

  for (const { key, data } of parts) {
    if (!data) continue;
    const startMin = timeToMinutes(data.start);
    let endMin = timeToMinutes(data.end);
    if (endMin <= startMin) endMin += 1440;
    
    const effectiveNow = nowMin < startMin && endMin > 1440 ? nowMin + 1440 : nowMin;
    
    if (effectiveNow >= startMin && effectiveNow < endMin) {
      return key;
    }
  }

  // Default to morning if nothing matches
  return "morning";
}

/**
 * Build day part options from normalized config
 */
export function buildDayPartOptions(dayParts: DayPartsNormalized): DayPartOption[] {
  const options: DayPartOption[] = [];

  if (dayParts.morning) {
    options.push({
      key: "morning",
      label: "Matin",
      startTime: dayParts.morning.start,
      endTime: dayParts.morning.end,
      color: dayParts.morning.color,
    });
  }

  if (dayParts.midday) {
    options.push({
      key: "midday",
      label: "Coupure",
      startTime: dayParts.midday.start,
      endTime: dayParts.midday.end,
      color: dayParts.midday.color,
    });
  }

  if (dayParts.evening) {
    options.push({
      key: "evening",
      label: "Soir",
      startTime: dayParts.evening.start,
      endTime: dayParts.evening.end,
      color: dayParts.evening.color,
    });
  }

  return options;
}

/**
 * Filter employees by day part
 * Returns only employees who have at least one session overlapping the selected part
 * V3: No special isEvening flag needed - overnight logic is handled by partEnd value
 */
export function filterByDayPart(
  employees: PresenceEmployeeCard[],
  partKey: DayPartKey,
  dayParts: DayPartsNormalized
): PresenceEmployeeCard[] {
  if (partKey === "all") return employees;

  const partData = dayParts[partKey];
  if (!partData) return employees;

  return employees.filter((emp) =>
    emp.sessions.some((session) =>
      sessionOverlapsPart(session, partData.start, partData.end)
    )
  );
}

/**
 * Main hook: provides day part options, current part, and filter function
 */
export function useDayPartFilter(establishmentId: string | null | undefined) {
  const { data: dayParts, isLoading } = useDayPartsNormalized(establishmentId ?? null);

  const options = useMemo(() => {
    if (!dayParts) return [];
    return buildDayPartOptions(dayParts);
  }, [dayParts]);

  const initialPart = useMemo(() => {
    if (!dayParts) return "morning" as DayPartKey;
    return getCurrentDayPart(dayParts);
  }, [dayParts]);

  const filter = useMemo(() => {
    return (employees: PresenceEmployeeCard[], partKey: DayPartKey) => {
      // ✅ FIX RACE CONDITION: Return empty array while loading to prevent flash
      if (!dayParts) return [];
      return filterByDayPart(employees, partKey, dayParts);
    };
  }, [dayParts]);

  return {
    options,
    initialPart,
    filter,
    isLoading,
    hasParts: options.length > 0,
  };
}
