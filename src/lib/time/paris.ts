/**
 * Paris timezone helpers
 * Single source of truth for time display across the app
 * V3.5 - Complete front timezone source + timeToMinutes + minutesToXhYY
 */

/**
 * Convert HH:mm or HH:mm:ss to minutes since midnight
 * Pure helper, no timezone involved (just string parsing)
 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Format minutes to "XhYY" display
 * Single source of truth for duration formatting across the app
 * Examples: 8 -> "0h08", 50 -> "0h50", 60 -> "1h00", 135 -> "2h15"
 * Returns "—" for null/undefined/0
 */
export function minutesToXhYY(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes <= 0) {
    return "—";
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m.toString().padStart(2, "0")}`;
}

/**
 * Normalize a Supabase timestamp to proper ISO format for JavaScript Date parsing
 * Supabase may return formats like:
 * - "2026-01-21 08:00:00+00" (space instead of T, short timezone)
 * - "2026-01-21T08:00:00.000Z" (standard ISO)
 * - "2026-01-21T08:00:00" (no timezone)
 */
function normalizeTimestamp(timestamp: string): string {
  if (!timestamp) return "";

  let isoStr = timestamp;

  // Replace space with T for standard ISO format
  if (isoStr.includes(" ") && !isoStr.includes("T")) {
    isoStr = isoStr.replace(" ", "T");
  }

  // Handle short timezone format (+00, -01, etc.) -> (+00:00, -01:00)
  const shortTzMatch = isoStr.match(/([+-]\d{2})$/);
  if (shortTzMatch) {
    isoStr = isoStr.replace(/([+-]\d{2})$/, "$1:00");
  }

  // If no timezone indicator, assume UTC
  if (!isoStr.includes("Z") && !isoStr.match(/[+-]\d{2}:\d{2}$/)) {
    isoStr += "Z";
  }

  return isoStr;
}

/**
 * Format a date/ISO string to HH:mm in Europe/Paris timezone
 * Safe for any browser timezone and handles Supabase timestamp formats
 */
export function formatParisHHMM(input: string | Date): string {
  try {
    let date: Date;

    if (typeof input === "string") {
      const normalized = normalizeTimestamp(input);
      date = new Date(normalized);
    } else {
      date = input;
    }

    if (isNaN(date.getTime())) {
      if (import.meta.env.DEV) console.warn("[formatParisHHMM] Invalid date:", input);
      return "--:--";
    }

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);

    const h = parts.find((p) => p.type === "hour")?.value || "00";
    const m = parts.find((p) => p.type === "minute")?.value || "00";
    return `${h}:${m}`;
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[formatParisHHMM] Error parsing:", input, error);
    return "--:--";
  }
}

/**
 * Format a date/ISO string to YYYY-MM-DD in Europe/Paris timezone
 * Use for day_date comparisons in presence/badgeuse modules
 */
export function formatParisDate(input: string | Date): string {
  try {
    const date = typeof input === "string" ? new Date(input) : input;

    if (isNaN(date.getTime())) {
      const now = new Date();
      return formatParisDateInternal(now);
    }

    return formatParisDateInternal(date);
  } catch {
    return formatParisDateInternal(new Date());
  }
}

/**
 * Get today's date in Europe/Paris timezone (YYYY-MM-DD)
 */
export function getTodayParis(): string {
  return formatParisDate(new Date());
}

/**
 * Get current HH:mm in Europe/Paris timezone
 * Use for comparing against shift times (DST-safe)
 */
export function getNowParisHHMM(): string {
  return formatParisHHMM(new Date());
}

/**
 * Get current month in YYYY-MM format (Europe/Paris timezone)
 * SSOT for all month-based navigation (presence, absences, payroll, etc.)
 */
export function getCurrentParisMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")?.value || "2024";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  return `${year}-${month}`;
}

/**
 * Internal helper to format date to YYYY-MM-DD Paris
 */
function formatParisDateInternal(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")?.value || "2024";
  const m = parts.find((p) => p.type === "month")?.value || "01";
  const d = parts.find((p) => p.type === "day")?.value || "01";
  return `${y}-${m}-${d}`;
}

/**
 * Format a date for Paris weekday (short: "lun.", "mar.", etc.)
 */
export function formatParisDayShort(input: string | Date): string {
  try {
    const date = typeof input === "string" ? new Date(input + "T12:00:00Z") : input;
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      weekday: "short",
    }).format(date);
  } catch {
    return "---";
  }
}

/**
 * Format a date for Paris day of month (1, 2, 3...)
 */
export function formatParisDayNumber(input: string | Date): string {
  try {
    const date = typeof input === "string" ? new Date(input + "T12:00:00Z") : input;
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      day: "numeric",
    }).format(date);
  } catch {
    return "-";
  }
}

/**
 * Format a date with options in Paris timezone
 */
export function formatParisLocale(
  input: string | Date,
  options: Intl.DateTimeFormatOptions
): string {
  try {
    const date = typeof input === "string" ? new Date(input + "T12:00:00Z") : input;
    return new Intl.DateTimeFormat("fr-FR", {
      ...options,
      timeZone: "Europe/Paris",
    }).format(date);
  } catch {
    return "-";
  }
}

/**
 * Build an ISO timestamp from a Paris date + time (DST-safe)
 * Use this when admin creates/updates badge events
 * @param dateStr YYYY-MM-DD (Paris date)
 * @param timeStr HH:mm (Paris time)
 * @returns ISO string in UTC
 */
export function buildParisISO(dateStr: string, timeStr: string): string {
  const [h, m] = timeStr.split(":").map(Number);

  // Create a reference date at noon Paris to get the correct offset
  const refDate = new Date(`${dateStr}T12:00:00Z`);

  // Get Paris offset for that date
  const parisFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parisParts = parisFormatter.formatToParts(refDate);
  const parisHour = parseInt(parisParts.find((p) => p.type === "hour")?.value || "12", 10);

  // UTC reference is 12:00, Paris hour tells us the offset
  // If Paris shows 13:00 when UTC is 12:00, offset is +1 (CET)
  // If Paris shows 14:00 when UTC is 12:00, offset is +2 (CEST)
  const offsetHours = parisHour - 12;

  // Build UTC time: Paris time - offset = UTC time
  const utcHour = h - offsetHours;
  const utcDate = new Date(`${dateStr}T00:00:00Z`);
  // setUTCHours handles rollover automatically (negative → previous day, ≥24 → next day)
  utcDate.setUTCHours(utcHour, m, 0, 0);

  return utcDate.toISOString();
}

/**
 * Normalize a time (HH:mm) to service day timeline minutes.
 * If time < cutoff, add 1440 (next calendar day, same service day).
 *
 * SSOT for overnight shift handling - use in Presence, Alerts, Absences.
 *
 * Example with cutoff "03:00":
 *   - 23:28 → 1408 (same calendar day)
 *   - 01:00 → 60 + 1440 = 1500 (post-midnight, still in service day)
 *   - 03:30 → 210 (next service day, no adjustment)
 *
 * @param timeHHMM - Time in HH:mm format
 * @param cutoffHHMM - Service day cutoff in HH:mm format (default "03:00")
 * @returns Minutes normalized to service day timeline
 */
export function normalizeToServiceDayTimeline(
  timeHHMM: string,
  cutoffHHMM: string = "03:00"
): number {
  const minutes = timeToMinutes(timeHHMM);
  const cutoffMinutes = timeToMinutes(cutoffHHMM);

  // If time is before cutoff, it belongs to the previous service day
  // Add 1440 to place it on the "next day" portion of the timeline
  if (minutes < cutoffMinutes) {
    return minutes + 1440;
  }

  return minutes;
}
