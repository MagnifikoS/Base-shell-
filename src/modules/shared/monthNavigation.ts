/**
 * ===============================================================================
 * SHARED -- Month Navigation Types & Utilities
 * ===============================================================================
 *
 * Extracted from factures module to break the circular dependency
 * between blApp and factures modules.
 *
 * BEFORE: blApp -> factures (for MonthNavigation, formatYearMonth, etc.)
 *         factures -> blApp (for BlAppTab component)
 *
 * AFTER:  blApp -> shared/monthNavigation
 *         factures -> shared/monthNavigation
 *         factures -> blApp (one-way, no cycle)
 *
 * ===============================================================================
 */

/**
 * Month navigation parameters
 */
export interface MonthNavigation {
  year: number;
  month: number; // 1-12
}

/**
 * Format month for display (e.g., "janvier 2026")
 */
export function formatYearMonth(year: number, month: number): string {
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

/**
 * Get current month as MonthNavigation
 */
export function getCurrentMonth(): MonthNavigation {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  };
}

/**
 * Format month as "YYYY-MM" for queries
 */
export function toYearMonthString(nav: MonthNavigation): string {
  return `${nav.year}-${String(nav.month).padStart(2, "0")}`;
}
