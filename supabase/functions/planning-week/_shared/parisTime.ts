/**
 * Paris timezone utilities for planning-week edge function
 * DST-safe implementation using Intl API
 * 
 * PATTERN: Same as badge-events/_shared/helpers.ts (proven correct)
 * RULE: ZERO setHours() naïf, ZERO hardcode +01:00/+02:00
 */

/**
 * Get Europe/Paris UTC offset in minutes for a given date.
 * Uses Intl API to handle DST automatically (no external lib).
 * Returns positive offset (e.g., +60 for winter CET, +120 for summer CEST).
 */
function getParisOffsetMinutes(date: Date): number {
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

  const utcH = parseInt(utcParts.find((p) => p.type === "hour")?.value || "0", 10);
  const utcM = parseInt(utcParts.find((p) => p.type === "minute")?.value || "0", 10);
  const parisH = parseInt(parisParts.find((p) => p.type === "hour")?.value || "0", 10);
  const parisM = parseInt(parisParts.find((p) => p.type === "minute")?.value || "0", 10);

  let diffMinutes = (parisH * 60 + parisM) - (utcH * 60 + utcM);

  // Handle day boundary (e.g., Paris 01:00, UTC 23:00 previous day)
  if (diffMinutes < -720) diffMinutes += 1440;
  if (diffMinutes > 720) diffMinutes -= 1440;

  return diffMinutes;
}

/**
 * Build a UTC Date instant from Paris local date + time.
 * 
 * @param dateStr - "YYYY-MM-DD" (Paris local date)
 * @param timeStr - "HH:mm" or "HH:mm:ss" (Paris local time)
 * @returns Date object representing that exact moment in UTC
 * 
 * USAGE: For comparing with badge_events.effective_at (which are UTC ISO strings)
 */
export function buildParisInstant(dateStr: string, timeStr: string): Date {
  const [h, m] = timeStr.slice(0, 5).split(":").map(Number);

  // Create a rough UTC date at noon to determine DST offset for that day
  const roughDate = new Date(`${dateStr}T12:00:00Z`);
  const offsetMinutes = getParisOffsetMinutes(roughDate);

  // Paris time = UTC + offset, so UTC = Paris time - offset
  const parisMinutes = h * 60 + m;
  const utcMinutes = parisMinutes - offsetMinutes;

  // Handle day rollover
  const [y, mo, d] = dateStr.split("-").map(Number);
  let utcDay = d;
  const utcMonth = mo - 1; // JS months are 0-indexed
  const utcYear = y;
  let finalMinutes = utcMinutes;

  if (utcMinutes < 0) {
    finalMinutes = utcMinutes + 1440;
    utcDay -= 1;
  } else if (utcMinutes >= 1440) {
    finalMinutes = utcMinutes - 1440;
    utcDay += 1;
  }

  const utcH = Math.floor(finalMinutes / 60);
  const utcM = finalMinutes % 60;

  return new Date(Date.UTC(utcYear, utcMonth, utcDay, utcH, utcM, 0, 0));
}

/**
 * Compute the previous day in YYYY-MM-DD format
 */
export function getPreviousDay(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  date.setUTCDate(date.getUTCDate() - 1);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Compute the next day in YYYY-MM-DD format
 */
export function getNextDay(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Get the Monday of the week containing a given date (YYYY-MM-DD)
 * Returns YYYY-MM-DD format
 */
export function getServiceDayMonday(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)); // noon to avoid TZ edge cases
  const dayOfWeek = date.getUTCDay(); // 0=Sunday, 1=Monday...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setUTCDate(date.getUTCDate() + diffToMonday);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Get the Monday of the NEXT week (7 days after the Monday of dateStr's week)
 * Returns YYYY-MM-DD format
 */
export function getNextWeekMonday(dateStr: string): string {
  const currentMonday = getServiceDayMonday(dateStr);
  const [y, mo, d] = currentMonday.split("-").map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  date.setUTCDate(date.getUTCDate() + 7);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Check if auto-publish is currently active for a given week
 * Auto-publish triggers every Sunday at the configured time for the NEXT week
 * 
 * SSOT: This is the single source of truth for auto-publish calculations
 * 
 * @param weekStart - The week start date (Monday) we're checking visibility for (YYYY-MM-DD)
 * @param autoPublishTime - The auto-publish time in HH:mm format (e.g., "20:00")
 * @returns true if the week should be visible via auto-publish
 */
export function isAutoPublishActive(
  weekStart: string,
  autoPublishTime: string
): boolean {
  // Get current Paris time
  const now = new Date();
  const parisParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  
  const parisYear = parseInt(parisParts.find((p) => p.type === "year")?.value || "2026", 10);
  const parisMonth = parseInt(parisParts.find((p) => p.type === "month")?.value || "01", 10) - 1;
  const parisDay = parseInt(parisParts.find((p) => p.type === "day")?.value || "01", 10);
  const parisHour = parseInt(parisParts.find((p) => p.type === "hour")?.value || "00", 10);
  const parisMinute = parseInt(parisParts.find((p) => p.type === "minute")?.value || "00", 10);
  
  // Parse week start date
  const [weekYear, weekMonth, weekDay] = weekStart.split("-").map(Number);
  const weekStartDate = new Date(weekYear, weekMonth - 1, weekDay);
  
  // Calculate the Sunday BEFORE the week start (auto-publish day for this week)
  // weekStart is Monday, so Sunday is 1 day before
  const autoPublishSunday = new Date(weekStartDate);
  autoPublishSunday.setDate(autoPublishSunday.getDate() - 1);
  
  // Current Paris date
  const currentParisDate = new Date(parisYear, parisMonth, parisDay);
  const autoPublishSundayDate = new Date(
    autoPublishSunday.getFullYear(),
    autoPublishSunday.getMonth(),
    autoPublishSunday.getDate()
  );
  
  // Parse auto-publish time
  const [pubHour, pubMinute] = autoPublishTime.split(":").map(Number);
  const currentMinutes = parisHour * 60 + parisMinute;
  const publishMinutes = pubHour * 60 + pubMinute;
  
  // Auto-publish is active if:
  // 1. Current date is AFTER the auto-publish Sunday, OR
  // 2. Current date IS the auto-publish Sunday AND current time >= publish time
  if (currentParisDate > autoPublishSundayDate) {
    return true;
  }
  
  if (currentParisDate.getTime() === autoPublishSundayDate.getTime() && currentMinutes >= publishMinutes) {
    return true;
  }
  
  return false;
}

/**
 * Get current date in Paris timezone as YYYY-MM-DD
 */
export function getTodayParis(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = parts.find((p) => p.type === "year")?.value || "2024";
  const m = parts.find((p) => p.type === "month")?.value || "01";
  const d = parts.find((p) => p.type === "day")?.value || "01";
  return `${y}-${m}-${d}`;
}
