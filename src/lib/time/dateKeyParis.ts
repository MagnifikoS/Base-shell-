/**
 * SSOT for "YYYY-MM-DD" date key generation in Europe/Paris timezone.
 *
 * ⚠️ CRITICAL: NEVER use `toISOString().split("T")[0]` to generate date keys for filters!
 *    This causes UTC shift which truncates the last day of month in Europe/Paris.
 *
 * This module provides timezone-safe helpers for generating date strings
 * used in database filters, without UTC shift.
 */

const PARIS_TZ = "Europe/Paris";

/**
 * Format a Date object to "YYYY-MM-DD" in Europe/Paris timezone.
 * This avoids UTC shift that would cause the last day of month to be excluded.
 *
 * @example
 * // Even at 23:00 Paris time on Jan 31st (which is 22:00 UTC on Jan 30th)
 * // this will correctly return "2026-01-31"
 * formatParisDateKey(new Date("2026-01-31T23:00:00+01:00")) // => "2026-01-31"
 */
export function formatParisDateKey(date: Date): string {
  // Use Intl.DateTimeFormat to get the date parts in Europe/Paris timezone
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PARIS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";

  return `${year}-${month}-${day}`;
}

/**
 * Get the first day of a month as "YYYY-MM-DD" (always returns "YYYY-MM-01").
 *
 * @param year - Full year (e.g., 2026)
 * @param monthIndex0 - Zero-based month index (0 = January, 11 = December)
 *
 * @example
 * getMonthStartDateKeyParis(2026, 0) // => "2026-01-01"
 * getMonthStartDateKeyParis(2026, 11) // => "2026-12-01"
 */
export function getMonthStartDateKeyParis(year: number, monthIndex0: number): string {
  // Month is 0-indexed, so we add 1 for display
  const month = monthIndex0 + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * Get the last day of a month as "YYYY-MM-DD".
 * Uses timezone-safe calculation to avoid UTC shift.
 *
 * @param year - Full year (e.g., 2026)
 * @param monthIndex0 - Zero-based month index (0 = January, 11 = December)
 *
 * @example
 * getMonthEndDateKeyParis(2026, 0) // => "2026-01-31" (January has 31 days)
 * getMonthEndDateKeyParis(2026, 1) // => "2026-02-28" (2026 is not a leap year)
 * getMonthEndDateKeyParis(2024, 1) // => "2024-02-29" (2024 is a leap year)
 * getMonthEndDateKeyParis(2026, 6) // => "2026-07-31" (July has 31 days)
 */
export function getMonthEndDateKeyParis(year: number, monthIndex0: number): string {
  // To get the last day of month N, we create a Date for day 0 of month N+1
  // This automatically rolls back to the last day of month N
  // We use .getDate() which returns the day number without UTC shift
  const lastDayNumber = new Date(year, monthIndex0 + 1, 0).getDate();
  const month = monthIndex0 + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDayNumber).padStart(2, "0")}`;
}

/**
 * Get month bounds from a "YYYY-MM" string.
 * Convenience wrapper for common use case.
 *
 * @param yearMonth - String in "YYYY-MM" format
 * @returns Object with start and end date keys
 *
 * @example
 * getMonthBoundsParis("2026-01") // => { start: "2026-01-01", end: "2026-01-31" }
 * getMonthBoundsParis("2026-07") // => { start: "2026-07-01", end: "2026-07-31" }
 */
export function getMonthBoundsParis(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split("-").map(Number);
  // month from yearMonth is 1-indexed, convert to 0-indexed for our functions
  const monthIndex0 = month - 1;
  return {
    start: getMonthStartDateKeyParis(year, monthIndex0),
    end: getMonthEndDateKeyParis(year, monthIndex0),
  };
}

/**
 * Add days to a date key and return the new date key.
 * Useful for calculating date ranges.
 *
 * @param dateKey - Starting date in "YYYY-MM-DD" format
 * @param deltaDays - Number of days to add (can be negative)
 * @returns New date key in "YYYY-MM-DD" format
 *
 * @example
 * addDaysToDateKey("2026-01-31", 1) // => "2026-02-01"
 * addDaysToDateKey("2026-02-01", -1) // => "2026-01-31"
 */
export function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day + deltaDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Get today's date key in Europe/Paris timezone.
 *
 * @example
 * getTodayDateKeyParis() // => "2026-01-31" (if today is Jan 31st in Paris)
 */
export function getTodayDateKeyParis(): string {
  return formatParisDateKey(new Date());
}

/**
 * Convert a date string (YYYY-MM-DD) to year-month format (YYYY-MM) in Europe/Paris timezone.
 * This is the SSOT for year_month calculation for invoice_line_items.
 *
 * @param dateStr - Date string in "YYYY-MM-DD" format (from extraction)
 * @returns Year-month string in "YYYY-MM" format
 *
 * @example
 * toYearMonthParis("2026-01-31") // => "2026-01"
 * toYearMonthParis("2026-12-15") // => "2026-12"
 */
export function toYearMonthParis(dateStr: string): string {
  // Parse the date string
  const [year, month] = dateStr.split("-").map(Number);

  // Validate
  if (!year || !month || month < 1 || month > 12) {
    if (import.meta.env.DEV)
      console.warn(`[toYearMonthParis] Invalid date string: ${dateStr}, using fallback`);
    // Fallback to current month in Paris
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: PARIS_TZ,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(now);
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const m = parts.find((p) => p.type === "month")?.value ?? "";
    return `${y}-${m}`;
  }

  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Get year-month from a Date object in Europe/Paris timezone.
 *
 * @param date - JavaScript Date object
 * @returns Year-month string in "YYYY-MM" format
 *
 * @example
 * getYearMonthFromDateParis(new Date("2026-01-31T23:59:59+01:00")) // => "2026-01"
 */
export function getYearMonthFromDateParis(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PARIS_TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";

  return `${year}-${month}`;
}
