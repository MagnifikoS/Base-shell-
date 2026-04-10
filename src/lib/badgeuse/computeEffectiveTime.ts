/**
 * Pure functions for effective time computation
 * Domain logic - no UI dependencies
 * V3.5: Uses Paris timezone source (timeToMinutes centralized)
 */

import { formatParisHHMM, timeToMinutes } from "@/lib/time/paris";

interface PlannedShift {
  start_time: string;
  end_time: string;
}

interface ToleranceSettings {
  arrival_tolerance_min: number;
  departure_tolerance_min: number;
}

/**
 * Convert minutes since midnight to HH:mm
 */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * Compute effective time based on PRD rules:
 * 
 * CLOCK_IN:
 * - Badge early (occurred <= planned_start): effective = planned_start (ALWAYS)
 * - Badge late within tolerance: effective = planned_start
 * - Badge late beyond tolerance: effective = occurred (real lateness)
 * 
 * CLOCK_OUT:
 * - Badge after end within tolerance: effective = planned_end
 * - Badge after end beyond tolerance: effective = occurred (extra suspected)
 * - Badge BEFORE planned_end: handled by SHIFT_NOT_FINISHED guard in edge
 */
export function computeEffectiveTime(
  occurredAt: Date,
  eventType: "clock_in" | "clock_out",
  plannedShift: PlannedShift | null,
  settings: ToleranceSettings
): string {
  // V3.3: Use Paris timezone for occurred time
  const occurredTime = formatParisHHMM(occurredAt);

  if (!plannedShift) {
    return occurredTime;
  }

  const plannedStart = plannedShift.start_time.slice(0, 5);
  const plannedEnd = plannedShift.end_time.slice(0, 5);

  if (eventType === "clock_in") {
    const plannedStartMinutes = timeToMinutes(plannedStart);
    const occurredMinutes = timeToMinutes(occurredTime);
    
    // PRD: Early arrival => always use planned start
    if (occurredMinutes <= plannedStartMinutes) {
      return plannedStart;
    }
    
    // Late arrival within tolerance => use planned start
    const lateMinutes = occurredMinutes - plannedStartMinutes;
    if (lateMinutes <= settings.arrival_tolerance_min) {
      return plannedStart;
    }
    
    // Late beyond tolerance => real lateness
    return occurredTime;
  } else {
    // CLOCK_OUT (early exit handled by guard, this is for on-time or late)
    const plannedEndMinutes = timeToMinutes(plannedEnd);
    const occurredMinutes = timeToMinutes(occurredTime);
    const lateMinutes = occurredMinutes - plannedEndMinutes;

    // Left after end within tolerance => use planned end
    if (lateMinutes >= 0 && lateMinutes <= settings.departure_tolerance_min) {
      return plannedEnd;
    }
    
    // Left very late => actual time (extra suspected)
    return occurredTime;
  }
}

/**
 * Format effective_at (TIMESTAMPTZ) for display as HH:mm in Paris timezone
 */
export function formatBadgeTime(effectiveAt: string | null | undefined): string {
  if (!effectiveAt) return "--:--";
  return formatParisHHMM(effectiveAt);
}
