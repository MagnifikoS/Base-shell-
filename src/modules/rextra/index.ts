/**
 * R-Extra Module - Public API
 * 
 * PHASE 2: Independent module for R.Extra (compensatory time off from overtime)
 * 
 * SSOT UNIQUE: Balance is calculated on-the-fly via:
 *   RExtra = total_extras_détectés - total_extras_payés - total_rextra_consommés
 * 
 * - NO stored balance (extras_deferred_minutes is NOT used)
 * - NO monthly carry-forward logic
 * - Planning reads directly from data.rextraBalanceByEmployee
 * 
 * Clean removal:
 * 1. DROP TABLE planning_rextra_events;
 * 2. Delete src/modules/rextra/*
 * 3. Delete supabase/functions/planning-rextra/*
 * 4. Delete supabase/functions/planning-week/_shared/rextraBalance.ts
 * 5. Remove integration points in:
 *    - getWeek.ts (import + call to computeRextraBalanceForUsers)
 *    - PlanningWeekRow.tsx (green badge, R.Extra option)
 *    - PlanningWeekCell.tsx (R.Extra badge)
 *    - PlanningWeekGrid.tsx (rextraBalances prop)
 *    - planning.types.ts (rextraBalanceByEmployee)
 *    - useAppRealtimeSync.ts (rextra + payroll validation channels)
 * 6. Build OK
 */

export * from "./types";
export { useRextraMutations } from "./useRextraMutations";
export { RextraInputModal } from "./RextraInputModal";
