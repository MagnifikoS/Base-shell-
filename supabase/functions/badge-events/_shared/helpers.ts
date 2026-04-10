/**
 * Badge Events Helpers
 * Extracted to keep main handler < 400 lines
 */
import { hashPin as _sharedHashPin, verifyPin as _sharedVerifyPin, hashPinPbkdf2 as _sharedHashPinPbkdf2, pinHashNeedsRehash as _sharedPinHashNeedsRehash } from "../../_shared/crypto.ts";

export interface PlannedShift {
  start_time: string;
  end_time: string;
}

export interface BadgeSettings {
  arrival_tolerance_min: number;
  departure_tolerance_min: number;
  extra_threshold_min: number;
  require_selfie: boolean;
  require_pin: boolean;
  device_binding_enabled: boolean;
  max_devices_per_user: number;
  early_arrival_limit_min: number; // Max minutes before shift start to accept badge
}

export const DEFAULT_SETTINGS: BadgeSettings = {
  arrival_tolerance_min: 10,
  departure_tolerance_min: 20,
  extra_threshold_min: 20,
  require_selfie: true,
  require_pin: true,
  device_binding_enabled: true,
  max_devices_per_user: 1,
  early_arrival_limit_min: 30,
};

/**
 * Convert HH:mm to minutes since midnight
 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Get Europe/Paris UTC offset in minutes for a given date.
 * Uses Intl API to handle DST automatically (no external lib).
 * Returns positive offset (e.g., +60 for winter, +120 for summer).
 */
function getParisOffsetMinutes(date: Date): number {
  // Format in UTC and Paris to find the difference
  const utcParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  
  const parisParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  
  const utcH = parseInt(utcParts.find(p => p.type === "hour")?.value || "0", 10);
  const utcM = parseInt(utcParts.find(p => p.type === "minute")?.value || "0", 10);
  const parisH = parseInt(parisParts.find(p => p.type === "hour")?.value || "0", 10);
  const parisM = parseInt(parisParts.find(p => p.type === "minute")?.value || "0", 10);
  
  let diffMinutes = (parisH * 60 + parisM) - (utcH * 60 + utcM);
  
  // Handle day boundary (e.g., Paris 01:00, UTC 23:00 previous day)
  if (diffMinutes < -720) diffMinutes += 1440;
  if (diffMinutes > 720) diffMinutes -= 1440;
  
  return diffMinutes;
}

/**
 * Extract HH:mm from a Date in Europe/Paris timezone.
 * Critical: Deno runtime is UTC, so we MUST use Intl to get Paris local time.
 */
function getParisTimeHHMM(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  
  const h = parts.find(p => p.type === "hour")?.value || "00";
  const m = parts.find(p => p.type === "minute")?.value || "00";
  return `${h}:${m}`;
}

/**
 * Build a UTC ISO timestamp from a Paris local date + time.
 * dayDate: "YYYY-MM-DD", time: "HH:mm" or "HH:mm:ss"
 * Returns ISO string representing that exact moment in UTC.
 * Exported for admin sync of extra_events.
 */
export function buildParisTimestamp(dayDate: string, time: string): string {
  const [h, m] = time.split(":").map(Number);
  
  // Create a rough UTC date to determine DST offset for that day
  const roughDate = new Date(`${dayDate}T12:00:00Z`);
  const offsetMinutes = getParisOffsetMinutes(roughDate);
  
  // Paris time = UTC + offset, so UTC = Paris time - offset
  const parisMinutes = h * 60 + m;
  const utcMinutes = parisMinutes - offsetMinutes;
  
  // Handle day rollover
  const [y, mo, d] = dayDate.split("-").map(Number);
  let utcDay = d;
  const utcMonth = mo - 1; // JS months are 0-indexed
  const utcYear = y;
  let finalMinutes = utcMinutes;
  
  if (utcMinutes < 0) {
    finalMinutes = utcMinutes + 1440;
    // Previous day - simplified, won't handle month boundaries in edge cases
    utcDay -= 1;
  } else if (utcMinutes >= 1440) {
    finalMinutes = utcMinutes - 1440;
    utcDay += 1;
  }
  
  const utcH = Math.floor(finalMinutes / 60);
  const utcM = finalMinutes % 60;
  
  const dt = new Date(Date.UTC(utcYear, utcMonth, utcDay, utcH, utcM, 0, 0));
  return dt.toISOString();
}

/**
 * Build a UTC ISO timestamp for a shift time on a given SERVICE DAY.
 * 
 * SERVICE DAY LOGIC:
 * - Service day = "business day" that may span midnight
 * - If time < cutoff, it belongs to the NEXT calendar day
 * - Example: serviceDay=2024-01-15, time=02:00, cutoff=03:00
 *   → Calendar day is 2024-01-16 (next day), Paris time 02:00
 * 
 * @param serviceDay - The service day (YYYY-MM-DD) from get_service_day RPC
 * @param time - HH:mm time string
 * @param cutoffHHMM - Cutoff time in HH:mm (e.g., "03:00")
 * @returns ISO timestamp in UTC
 */
export function buildServiceDayTimestamp(
  serviceDay: string,
  time: string,
  cutoffHHMM: string
): string {
  const timeMin = timeToMinutes(time.slice(0, 5));
  const cutoffMin = timeToMinutes(cutoffHHMM.slice(0, 5));
  
  // If time < cutoff, it's on the NEXT calendar day
  if (timeMin < cutoffMin) {
    // Add 1 day to serviceDay
    const [y, mo, d] = serviceDay.split("-").map(Number);
    const nextDay = new Date(Date.UTC(y, mo - 1, d + 1, 12, 0, 0));
    const nextDayStr = nextDay.toISOString().slice(0, 10);
    return buildParisTimestamp(nextDayStr, time);
  }
  
  return buildParisTimestamp(serviceDay, time);
}

/**
 * Compare occurred timestamp with planned end using SERVICE DAY logic.
 * 
 * This is the SINGLE SOURCE OF TRUTH for early departure detection.
 * 
 * @param occurredAt - Actual badge timestamp (Date)
 * @param plannedStartHHMM - Planned start time (HH:mm)
 * @param plannedEndHHMM - Planned end time (HH:mm)
 * @param serviceDay - Service day from get_service_day RPC
 * @param cutoffHHMM - Establishment cutoff (e.g., "03:00")
 * @returns { isEarlyDeparture: boolean, minutesEarly: number, plannedEndTs: string }
 */
export function checkEarlyDeparture(
  occurredAt: Date,
  plannedStartHHMM: string,
  plannedEndHHMM: string,
  serviceDay: string,
  cutoffHHMM: string
): { isEarlyDeparture: boolean; minutesEarly: number; plannedEndTs: string } {
  const plannedStart = plannedStartHHMM.slice(0, 5);
  const plannedEnd = plannedEndHHMM.slice(0, 5);
  
  // Build absolute timestamps for planned times
  const plannedStartTs = new Date(buildServiceDayTimestamp(serviceDay, plannedStart, cutoffHHMM));
  let plannedEndTs = new Date(buildServiceDayTimestamp(serviceDay, plannedEnd, cutoffHHMM));
  
  // Handle overnight shift: if end <= start, end is on next day
  // This can happen even with cutoff logic if shift spans midnight
  if (plannedEndTs.getTime() <= plannedStartTs.getTime()) {
    plannedEndTs = new Date(plannedEndTs.getTime() + 24 * 60 * 60 * 1000);
  }
  
  const occurredMs = occurredAt.getTime();
  const plannedEndMs = plannedEndTs.getTime();
  
  const diffMs = plannedEndMs - occurredMs;
  const minutesEarly = Math.floor(diffMs / 60000);
  
  return {
    isEarlyDeparture: occurredMs < plannedEndMs,
    minutesEarly: Math.max(0, minutesEarly),
    plannedEndTs: plannedEndTs.toISOString(),
  };
}

/**
 * Check if employee is arriving too early before shift start using SERVICE DAY logic.
 * 
 * This is the SINGLE SOURCE OF TRUTH for early arrival detection.
 * Uses absolute timestamps (not HH:mm comparison) to handle all edge cases:
 * - Overnight shifts
 * - Post-midnight badges belonging to previous service day
 * - DST transitions
 * 
 * @param occurredAt - Actual badge timestamp (Date)
 * @param plannedStartHHMM - Planned start time (HH:mm)
 * @param plannedEndHHMM - Planned end time (HH:mm) - used to detect overnight shifts
 * @param serviceDay - Service day from get_service_day RPC
 * @param cutoffHHMM - Establishment cutoff (e.g., "03:00")
 * @param earlyArrivalLimitMin - Max allowed minutes before shift start
 * @returns { isTooEarly: boolean, minutesEarly: number, plannedStartTs: string }
 */
export function checkEarlyArrival(
  occurredAt: Date,
  plannedStartHHMM: string,
  plannedEndHHMM: string,
  serviceDay: string,
  cutoffHHMM: string,
  earlyArrivalLimitMin: number
): { isTooEarly: boolean; minutesEarly: number; plannedStartTs: string } {
  const plannedStart = plannedStartHHMM.slice(0, 5);
  const plannedEnd = plannedEndHHMM.slice(0, 5);
  
  // Build absolute timestamps for planned times using service day
  const plannedStartTs = new Date(buildServiceDayTimestamp(serviceDay, plannedStart, cutoffHHMM));
  const _plannedEndTs = new Date(buildServiceDayTimestamp(serviceDay, plannedEnd, cutoffHHMM));

  // For overnight shifts (end <= start in absolute time), no adjustment needed for start
  // The service day timestamp already places start on the correct calendar day

  const occurredMs = occurredAt.getTime();
  const plannedStartMs = plannedStartTs.getTime();
  
  // Calculate how early the badge is (positive = early, negative = late)
  const diffMs = plannedStartMs - occurredMs;
  const minutesEarly = Math.floor(diffMs / 60000);
  
  // isTooEarly = badge is more than earlyArrivalLimitMin before planned start
  const isTooEarly = minutesEarly > earlyArrivalLimitMin;
  
  return {
    isTooEarly,
    minutesEarly: Math.max(0, minutesEarly),
    plannedStartTs: plannedStartTs.toISOString(),
  };
}


/**
 * Compute effective_at (TIMESTAMPTZ) based on PRD rules:
 * 
 * CLOCK_IN:
 * - Badge early (occurred <= planned_start): effective = planned_start
 * - Badge late within tolerance: effective = planned_start
 * - Badge late beyond tolerance: effective = occurred (real lateness)
 * 
 * CLOCK_OUT:
 * - Badge after end within tolerance: effective = planned_end
 * - Badge after end beyond tolerance: effective = occurred (for extra request)
 * - Badge BEFORE planned_end: handled separately (SHIFT_NOT_FINISHED guard)
 * 
 * Returns ISO string (TIMESTAMPTZ format) for direct DB storage.
 */
export function computeEffectiveAt(
  occurredAt: Date,
  eventType: "clock_in" | "clock_out",
  plannedShift: PlannedShift | null,
  dayDate: string,
  cutoffHHMM: string,
  settings: { arrival_tolerance_min: number; departure_tolerance_min: number }
): string {
  // V15: Use buildServiceDayTimestamp (cutoff-aware) instead of buildParisTimestamp
  // to fix off-by-one-day for overnight shifts (times like "00:27" on service day)
  const buildTimestamp = (time: string): string => {
    return buildServiceDayTimestamp(dayDate, time, cutoffHHMM);
  };

  // Extract occurred time in Paris timezone (Deno runs in UTC!)
  const occurredTime = getParisTimeHHMM(occurredAt);

  if (!plannedShift) {
    return buildTimestamp(occurredTime);
  }

  const plannedStart = plannedShift.start_time.slice(0, 5);
  const plannedEnd = plannedShift.end_time.slice(0, 5);

  if (eventType === "clock_in") {
    const plannedStartMinutes = timeToMinutes(plannedStart);
    const occurredMinutes = timeToMinutes(occurredTime);
    
    if (occurredMinutes <= plannedStartMinutes) {
      return buildTimestamp(plannedStart);
    }
    
    const lateMinutes = occurredMinutes - plannedStartMinutes;
    if (lateMinutes <= settings.arrival_tolerance_min) {
      return buildTimestamp(plannedStart);
    }
    
    return buildTimestamp(occurredTime);
  } else {
    // V15: For clock_out, use absolute timestamp comparison to handle overnight shifts
    const plannedEndTs = new Date(buildServiceDayTimestamp(dayDate, plannedEnd, cutoffHHMM));
    const plannedStartTs = new Date(buildServiceDayTimestamp(dayDate, plannedStart, cutoffHHMM));
    
    // Handle overnight shift: if end <= start, end is on next day
    let adjustedPlannedEndTs = plannedEndTs;
    if (plannedEndTs.getTime() <= plannedStartTs.getTime()) {
      adjustedPlannedEndTs = new Date(plannedEndTs.getTime() + 24 * 60 * 60 * 1000);
    }
    
    const lateMs = occurredAt.getTime() - adjustedPlannedEndTs.getTime();
    const lateMinutes = Math.floor(lateMs / 60000);

    if (lateMinutes >= 0 && lateMinutes <= settings.departure_tolerance_min) {
      return buildTimestamp(plannedEnd);
    }
    
    return buildTimestamp(occurredTime);
  }
}

/**
 * Simple hash for PIN (SHA-256 + salt)
 * Delegated to _shared/crypto.ts (SSOT)
 * @deprecated SEC-PIN-001: Use hashPinPbkdf2() for new PINs. This legacy SHA-256
 * re-export is kept only for backward-compatible verification in verifyPin().
 */
// TODO: Remove legacy SHA-256 path after migration window (SEC-PIN-001)
export const hashPin = _sharedHashPin;

/**
 * Verify a PIN supporting legacy SHA-256, bcrypt, and PBKDF2 hashes.
 * Delegated to _shared/crypto.ts (SSOT)
 */
export const verifyPin = _sharedVerifyPin;

/**
 * Hash a PIN using PBKDF2-SHA256 (SEC-01 recommended).
 * Delegated to _shared/crypto.ts (SSOT)
 */
export const hashPinPbkdf2 = _sharedHashPinPbkdf2;

/**
 * Check if stored hash needs migration to PBKDF2.
 * Delegated to _shared/crypto.ts (SSOT)
 */
export const pinHashNeedsRehash = _sharedPinHashNeedsRehash;

/**
 * Find the next planned shift after the current sequence index.
 * Returns null if no next shift exists.
 */
export function findNextShift(
  plannedShifts: PlannedShift[] | null,
  currentSequenceIndex: number
): { start_time: string; end_time: string; sequence_index: number } | null {
  if (!plannedShifts || plannedShifts.length <= currentSequenceIndex) {
    return null;
  }
  const nextShift = plannedShifts[currentSequenceIndex];
  if (!nextShift) return null;
  return {
    start_time: nextShift.start_time.slice(0, 5),
    end_time: nextShift.end_time.slice(0, 5),
    sequence_index: currentSequenceIndex + 1,
  };
}

/**
 * Check if badge is after shift end using absolute timestamps.
 * 
 * V10 REFACTOR: Uses absolute UTC timestamps (not HH:mm arithmetic).
 * This eliminates ALL edge cases with post-midnight badges and overnight shifts.
 * 
 * SINGLE SOURCE OF TRUTH: Same pattern as checkEarlyDeparture/checkEarlyArrival.
 * 
 * @param occurredAt - Actual badge timestamp (Date)
 * @param plannedStartHHMM - Planned start time (HH:mm)
 * @param plannedEndHHMM - Planned end time (HH:mm)
 * @param serviceDay - Service day from get_service_day RPC
 * @param cutoffHHMM - Establishment cutoff (e.g., "03:00")
 * @returns true if badge is AFTER shift end
 */
export function checkShiftEnded(
  occurredAt: Date,
  plannedStartHHMM: string,
  plannedEndHHMM: string,
  serviceDay: string,
  cutoffHHMM: string
): boolean {
  const plannedStart = plannedStartHHMM.slice(0, 5);
  const plannedEnd = plannedEndHHMM.slice(0, 5);
  
  // Build absolute timestamps for planned times using service day
  const plannedStartTs = new Date(buildServiceDayTimestamp(serviceDay, plannedStart, cutoffHHMM));
  let plannedEndTs = new Date(buildServiceDayTimestamp(serviceDay, plannedEnd, cutoffHHMM));
  
  // Handle overnight shift: if end <= start, end is on next day
  if (plannedEndTs.getTime() <= plannedStartTs.getTime()) {
    plannedEndTs = new Date(plannedEndTs.getTime() + 24 * 60 * 60 * 1000);
  }
  
  return occurredAt.getTime() > plannedEndTs.getTime();
}

/**
 * @deprecated Use checkShiftEnded() instead - this uses fragile HH:mm arithmetic.
 * Kept for backwards compatibility only. DO NOT USE for new code.
 * 
 * Check if occurred time is after planned end time (shift finished).
 * Both times should be in HH:mm format.
 */
export function isAfterShiftEnd(
  occurredTime: string,
  plannedEnd: string,
  plannedStart?: string
): boolean {
  let occurredMin = timeToMinutes(occurredTime);
  let plannedEndMin = timeToMinutes(plannedEnd);
  
  if (plannedStart) {
    const plannedStartMin = timeToMinutes(plannedStart);
    
    if (plannedEndMin < plannedStartMin) {
      // Case 1: Overnight shift - adjust end to next day
      plannedEndMin += 1440;
      
      // If occurred is after midnight, adjust too
      if (occurredMin < plannedStartMin) {
        occurredMin += 1440;
      }
    } else if (occurredMin < plannedStartMin) {
      // Case 2: NON-overnight shift BUT badge is after midnight
      // Badge belongs to service day of "yesterday" but clock shows 02:00
      // → Add 1440 to treat as next day relative to shift
      occurredMin += 1440;
    }
  }
  
  return occurredMin > plannedEndMin;
}

/**
 * Extract HH:mm from a Date in Europe/Paris timezone (exported for userHandlers).
 */
export function getParisHHMM(date: Date): string {
  return getParisTimeHHMM(date);
}

/**
 * Pure helper for clock_in: computes effective_at and late_minutes using absolute timestamps.
 * 
 * V10 REFACTOR: Uses absolute timestamps for accurate overnight/service-day handling.
 * 
 * Rules (PRD):
 * - Badge before start → effective = planned_start, late = 0
 * - Badge late <= tolerance → effective = planned_start, late = 0
 * - Badge late > tolerance → effective = occurred, late = actual late minutes
 * 
 * @param occurredAt - Date object of actual badge time
 * @param plannedStartHHMM - Planned start in HH:mm format
 * @param serviceDay - Service day in YYYY-MM-DD format
 * @param cutoffHHMM - Establishment cutoff (e.g., "03:00")
 * @param arrivalToleranceMin - Tolerance in minutes (from settings)
 * @returns { effectiveAtISO, lateMinutes }
 */
export function computeClockInEffectiveAndLateV2(
  occurredAt: Date,
  plannedStartHHMM: string,
  serviceDay: string,
  cutoffHHMM: string,
  arrivalToleranceMin: number
): { effectiveAtISO: string; lateMinutes: number | null } {
  const plannedStart = plannedStartHHMM.slice(0, 5);
  
  // Build absolute timestamp for planned start using service day
  const plannedStartTs = new Date(buildServiceDayTimestamp(serviceDay, plannedStart, cutoffHHMM));
  
  // Calculate difference in milliseconds
  const diffMs = occurredAt.getTime() - plannedStartTs.getTime();
  const rawLateMinutes = Math.floor(diffMs / 60000);
  
  // Case 1: Badge before or at start → effective = planned, late = 0
  if (rawLateMinutes <= 0) {
    return {
      effectiveAtISO: plannedStartTs.toISOString(),
      lateMinutes: 0,
    };
  }
  
  // Case 2: Badge late within tolerance → effective = planned, late = 0
  if (rawLateMinutes <= arrivalToleranceMin) {
    return {
      effectiveAtISO: plannedStartTs.toISOString(),
      lateMinutes: 0, // PRD: within tolerance = no lateness recorded
    };
  }
  
  // Case 3: Badge late beyond tolerance → effective = occurred, late = actual
  return {
    effectiveAtISO: occurredAt.toISOString(),
    lateMinutes: rawLateMinutes,
  };
}

/**
 * @deprecated Use computeClockInEffectiveAndLateV2() instead.
 * This version uses fragile HH:mm arithmetic that fails on overnight/service-day boundaries.
 * 
 * Pure helper for clock_in: computes effective_at and late_minutes respecting tolerance.
 */
export function computeClockInEffectiveAndLate(
  occurredAtISO: string,
  plannedStartHHMM: string,
  dayDate: string,
  arrivalToleranceMin: number
): { effectiveAtISO: string; lateMinutes: number | null } {
  const occurredAt = new Date(occurredAtISO);
  const occurredTime = getParisTimeHHMM(occurredAt);
  
  const plannedStartMin = timeToMinutes(plannedStartHHMM);
  const occurredMin = timeToMinutes(occurredTime);
  
  // Calculate raw lateness
  const rawLate = occurredMin - plannedStartMin;
  
  // Case 1: Badge before or at start → effective = planned, late = 0
  if (rawLate <= 0) {
    return {
      effectiveAtISO: buildParisTimestamp(dayDate, plannedStartHHMM),
      lateMinutes: 0,
    };
  }
  
  // Case 2: Badge late within tolerance → effective = planned, late = 0
  if (rawLate <= arrivalToleranceMin) {
    return {
      effectiveAtISO: buildParisTimestamp(dayDate, plannedStartHHMM),
      lateMinutes: 0, // PRD: within tolerance = no lateness recorded
    };
  }
  
  // Case 3: Badge late beyond tolerance → effective = occurred, late = actual
  return {
    effectiveAtISO: buildParisTimestamp(dayDate, occurredTime),
    lateMinutes: rawLate,
  };
}
