/**
 * Service Day Badge Helper
 * 
 * SINGLE SOURCE OF TRUTH for converting admin-entered times to UTC timestamps.
 * 
 * GOLD RULE: 
 * - serviceDay = jour de service (YYYY-MM-DD) - from RPC get_service_day
 * - timeHHMM = heure saisie en Europe/Paris (HH:mm)
 * - cutoffHHMM = cutoff établissement (HH:mm) - typically "03:00"
 * 
 * If timeHHMM < cutoffHHMM (e.g., 00:30 < 03:00), the badge happened on 
 * calendar day = serviceDay + 1, but still belongs to serviceDay.
 * 
 * Example:
 *   serviceDay = "2026-01-22", time = "00:30", cutoff = "03:00"
 *   → calendar day = "2026-01-23" (next day)
 *   → occurred_at = "2026-01-22T23:30:00Z" (00:30 Paris on Jan 23 = 23:30 UTC on Jan 22, in CET+1)
 *   → day_date stays = "2026-01-22" (service day)
 */

import { timeToMinutes } from "./paris";

/**
 * Get Paris timezone offset in hours for a given date
 * Returns +1 for CET (winter) or +2 for CEST (summer)
 */
function getParisOffsetHours(date: Date): number {
  const parisFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parisParts = parisFormatter.formatToParts(date);
  const parisHour = parseInt(parisParts.find((p) => p.type === "hour")?.value || "12", 10);
  
  // Create reference at noon UTC
  const utcHour = date.getUTCHours();
  const diff = parisHour - utcHour;
  
  // Normalize to handle day boundary
  return diff < -12 ? diff + 24 : diff > 12 ? diff - 24 : diff;
}

/**
 * Build occurred_at (UTC ISO) from service day + input time
 * 
 * @param params.serviceDay - The service day (YYYY-MM-DD) from RPC
 * @param params.timeHHMM - Time entered by admin (HH:mm in Paris timezone)
 * @param params.cutoffHHMM - Establishment cutoff (HH:mm), typically "03:00"
 * @returns UTC ISO timestamp string
 */
export function buildOccurredAtFromServiceDay(params: {
  serviceDay: string;
  timeHHMM: string;
  cutoffHHMM: string;
}): string {
  const { serviceDay, timeHHMM, cutoffHHMM } = params;
  
  const timeMinutes = timeToMinutes(timeHHMM);
  const cutoffMinutes = timeToMinutes(cutoffHHMM);
  
  // Determine calendar day: if time < cutoff, it's actually the NEXT calendar day
  let calendarDay: string;
  if (timeMinutes < cutoffMinutes) {
    // Time is after midnight but before cutoff → calendar day is serviceDay + 1
    const serviceDayDate = new Date(serviceDay + "T12:00:00Z");
    serviceDayDate.setUTCDate(serviceDayDate.getUTCDate() + 1);
    calendarDay = serviceDayDate.toISOString().slice(0, 10);
  } else {
    // Time is >= cutoff → same calendar day as service day
    calendarDay = serviceDay;
  }
  
  // Now build the UTC timestamp for (calendarDay, timeHHMM) in Paris
  const [h, m] = timeHHMM.split(":").map(Number);
  
  // Get Paris offset for that calendar day (DST-safe)
  const refDate = new Date(`${calendarDay}T12:00:00Z`);
  const offsetHours = getParisOffsetHours(refDate);
  
  // Build UTC time: Paris time - offset = UTC time
  const utcHour = h - offsetHours;
  const utcDate = new Date(`${calendarDay}T00:00:00Z`);
  
  // Handle day rollover
  if (utcHour < 0) {
    utcDate.setUTCDate(utcDate.getUTCDate() - 1);
    utcDate.setUTCHours(24 + utcHour, m, 0, 0);
  } else if (utcHour >= 24) {
    utcDate.setUTCDate(utcDate.getUTCDate() + 1);
    utcDate.setUTCHours(utcHour - 24, m, 0, 0);
  } else {
    utcDate.setUTCHours(utcHour, m, 0, 0);
  }
  
  return utcDate.toISOString();
}

/**
 * Get the calendar day from service day + time
 * Useful for display/validation purposes
 * 
 * @param serviceDay - The service day (YYYY-MM-DD)
 * @param timeHHMM - Time entered (HH:mm in Paris)
 * @param cutoffHHMM - Establishment cutoff (HH:mm)
 * @returns Calendar day (YYYY-MM-DD)
 */
export function getCalendarDayFromServiceDay(
  serviceDay: string,
  timeHHMM: string,
  cutoffHHMM: string
): string {
  const timeMinutes = timeToMinutes(timeHHMM);
  const cutoffMinutes = timeToMinutes(cutoffHHMM);
  
  if (timeMinutes < cutoffMinutes) {
    // Time is after midnight but before cutoff → calendar day is serviceDay + 1
    const serviceDayDate = new Date(serviceDay + "T12:00:00Z");
    serviceDayDate.setUTCDate(serviceDayDate.getUTCDate() + 1);
    return serviceDayDate.toISOString().slice(0, 10);
  }
  
  return serviceDay;
}
