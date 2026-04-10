/**
 * Business Day Helper for Cash Module
 * 
 * IMPORTANT: All business day logic should use the backend RPC
 * `get_service_day(establishment_id, timestamp)` which respects
 * the establishment's `service_day_cutoff` parameter.
 * 
 * This file ONLY contains FORMATTING utilities - no day calculation.
 */

/**
 * Convert YYYY-MM-DD string to a safe Date at 12:00:00 UTC
 * This prevents any timezone from shifting the day.
 */
export function toSafeMiddayUTC(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/**
 * Add or subtract days from a date string, returning YYYY-MM-DD
 * Uses UTC operations only - no local timezone involved.
 */
export function addDaysSafe(dateStr: string, delta: number): string {
  const date = toSafeMiddayUTC(dateStr);
  date.setUTCDate(date.getUTCDate() + delta);
  
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Format a date string for display in French locale, using Europe/Paris timezone.
 * Uses safe midday UTC anchor - never relies on local timezone.
 */
export function formatBusinessDay(dateStr: string): string {
  const safeDate = toSafeMiddayUTC(dateStr);
  
  return safeDate.toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ❌ REMOVED LEGACY FUNCTIONS
// 
// getBusinessDayDateParis() and isBusinessDayToday() have been removed.
// These used hardcoded hour<3 cutoff logic which is NOT establishment-aware.
// 
// ✅ USE INSTEAD: useServiceDayToday(establishmentId) hook
// or direct RPC call: supabase.rpc("get_service_day_now", { _establishment_id })
// ═══════════════════════════════════════════════════════════════════════════
