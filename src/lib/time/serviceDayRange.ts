/**
 * serviceDayRange — Compute UTC bounds for a given service day + cutoff.
 *
 * A "service day" runs from cutoff (Paris) on the date key to cutoff (Paris) the next day.
 * Example: serviceDay="2026-02-20", cutoff="03:00"
 *   → Paris range: 2026-02-20 03:00 → 2026-02-21 03:00
 *   → UTC range depends on DST (CET=+1 → 02:00Z–02:00Z, CEST=+2 → 01:00Z–01:00Z)
 *
 * This module converts Paris cutoff times to exact UTC ISO strings using Intl,
 * ensuring DST correctness without hardcoding offsets.
 */

/**
 * Get the UTC offset in hours for a given Paris datetime.
 * Uses Intl to detect CET (+1) vs CEST (+2) automatically.
 */
function getParisOffsetHours(dateStr: string, timeStr: string): number {
  // Build a reference date at noon UTC on the target date to detect DST
  const refDate = new Date(`${dateStr}T12:00:00Z`);
  const parisFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = parisFormatter.formatToParts(refDate);
  const parisHour = parseInt(parts.find((p) => p.type === "hour")?.value || "12", 10);
  // When UTC = 12:00, Paris = 13:00 (CET, offset +1) or 14:00 (CEST, offset +2)
  return parisHour - 12;
}

/**
 * Convert a Paris date + time to a UTC ISO string.
 * DST-safe via Intl offset detection.
 */
function parisToUtcIso(dateStr: string, timeHHMM: string): string {
  const [h, m] = timeHHMM.split(":").map(Number);
  const offset = getParisOffsetHours(dateStr, timeHHMM);
  
  // UTC hour = Paris hour - offset
  const utcDate = new Date(`${dateStr}T00:00:00Z`);
  utcDate.setUTCHours(h - offset, m, 0, 0);
  
  return utcDate.toISOString();
}

/**
 * Compute the UTC range [start, end) for a service day.
 *
 * Service day D with cutoff C runs from:
 *   Paris: D @ C:00 → D+1 @ C:00
 *   (converted to UTC accounting for DST)
 *
 * @param serviceDayDateKey - "YYYY-MM-DD" service day date key (from RPC SSOT)
 * @param cutoffHHMM - Establishment cutoff in "HH:mm" (from establishments.service_day_cutoff)
 * @returns { startUtc, endUtc } as ISO strings suitable for Supabase .gte/.lt filters
 */
export function getServiceDayUtcRange(
  serviceDayDateKey: string,
  cutoffHHMM: string = "03:00"
): { startUtc: string; endUtc: string } {
  // Start = serviceDay date @ cutoff Paris → UTC
  const startUtc = parisToUtcIso(serviceDayDateKey, cutoffHHMM);
  
  // End = next calendar day @ cutoff Paris → UTC
  const [y, mo, d] = serviceDayDateKey.split("-").map(Number);
  const nextDay = new Date(y, mo - 1, d + 1);
  const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, "0")}-${String(nextDay.getDate()).padStart(2, "0")}`;
  const endUtc = parisToUtcIso(nextDayStr, cutoffHHMM);
  
  return { startUtc, endUtc };
}
