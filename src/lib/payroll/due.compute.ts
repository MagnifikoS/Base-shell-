/**
 * DUE HOURS ENGINE — Pure computation functions for deduction handling
 * 
 * SIMPLIFIED VERSION: Only "DEDUCT" mode remains.
 * Retards + Départs anticipés = toujours déduits du salaire du mois.
 * 
 * RULES:
 * - All values in MINUTES
 * - NO side effects
 * - NO database writes
 * - Pure functions only
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DueComputeResult {
  /** Minutes to deduct from salary */
  deductMinutesFromSalary: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute due minutes for month (deduction only)
 * 
 * This is a PURE function with NO side effects.
 * All due minutes are always deducted from salary.
 * 
 * @param timeDeductionMinutes - Time deduction minutes (late + early departure)
 * @returns Computed result (deduction minutes)
 */
export function computeDueMinutesForMonth(timeDeductionMinutes: number): DueComputeResult {
  const deductions = Math.max(0, timeDeductionMinutes || 0);

  return {
    deductMinutesFromSalary: deductions,
  };
}

/**
 * Format minutes to HH:MM string for display
 */
export function formatDueMinutesToHHMM(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "00:00";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
