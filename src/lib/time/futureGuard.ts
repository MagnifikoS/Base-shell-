/**
 * Future Badge Guard - UX helpers
 *
 * PHASE 3.1: Prevent future date/time selection in badge modals
 * The backend is the source of truth (FUTURE_BADGE_BLOCKED),
 * but UX should guide users before they hit the API.
 */

import { getNowParisHHMM, getTodayParis } from "./paris";

/**
 * Check if a given date (YYYY-MM-DD) is in the future relative to today (Paris TZ)
 */
export function isDateInFuture(dateStr: string): boolean {
  const todayParis = getTodayParis();
  return dateStr > todayParis;
}

/**
 * Check if a given time (HH:mm) is in the future for today (Paris TZ)
 * Returns false if the date is in the past (time doesn't matter)
 */
export function isTimeInFutureForDate(dateStr: string, timeHHMM: string): boolean {
  const todayParis = getTodayParis();

  // Past date: time is never "in future"
  if (dateStr < todayParis) return false;

  // Future date: always in future
  if (dateStr > todayParis) return true;

  // Same day: compare time
  const nowHHMM = getNowParisHHMM();
  return timeHHMM > nowHHMM;
}

/**
 * Get max allowed time for a given service day
 * Returns current time (HH:mm) if today, or "23:45" if past date
 */
export function getMaxTimeForDate(dateStr: string): string {
  const todayParis = getTodayParis();

  if (dateStr < todayParis) {
    // Past date: any time is valid
    return "23:45";
  }

  if (dateStr > todayParis) {
    // Future date: no time is valid (should not be selectable)
    return "00:00";
  }

  // Today: max is current time
  return getNowParisHHMM();
}

/**
 * Filter time options to only include past/present times
 * For use in TimeSelect component
 */
export function filterPastTimeOptions(
  options: Array<{ value: string; label: string }>,
  dateStr: string
): Array<{ value: string; label: string }> {
  const maxTime = getMaxTimeForDate(dateStr);
  return options.filter((opt) => opt.value <= maxTime);
}

/**
 * Helper text for badge creation/edit modals
 */
export const BADGE_HELPER_TEXT = "Un badge représente un événement passé ou présent.";
