/**
 * R-EXTRA BALANCE CALCULATION (SSOT UNIQUE - SIMPLIFIÉ)
 * 
 * Ce module calcule le solde R-Extra de manière dynamique, sans dépendre
 * d'un champ "solde persisté" et SANS logique de report mensuel.
 * 
 * FORMULE UNIQUE:
 *   RExtra = total_extras_detectés - total_extras_payés - total_rextra_consommés
 * 
 * où:
 *   - total_extras_detectés = extras planning + extras badgeuse approuvés (TOUT historique)
 *   - total_extras_payés = SUM(extras_paid_eur) converti en minutes (TOUT historique)
 *   - total_rextra_consommés = SUM(planning_rextra_events.minutes) (TOUT historique)
 * 
 * IMPORTANT:
 *   - Pas de report M→M+1 complexe
 *   - Calcul global all-time, pas par mois
 *   - Ce calcul est la SSOT unique pour R-Extra
 *   - Module entièrement supprimable sans casser Planning
 * 
 * @see /docs/prd-extra-planning-hebdo.md
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

type AnyClient = SupabaseClient;

/** Conversion factor: weeks per month (French labor law: 52/12) */
const WEEKS_PER_MONTH = 52 / 12;

/**
 * Calculate weekly extras from shifts (same logic as payroll engine)
 * Extras = sum per week of max(0, worked - contractHours × 60)
 * Week belongs to month of its Sunday
 */
function calculateWeeklyExtras(
  shifts: Array<{ shift_date: string; net_minutes: number }>,
  contractHours: number
): number {
  // Group shifts by ISO week (Monday-Sunday)
  const weekMap = new Map<string, number>();
  
  for (const shift of shifts) {
    const date = new Date(shift.shift_date + "T12:00:00Z");
    const dayOfWeek = date.getDay(); // 0=Sunday, 1=Monday, ...
    
    // Get Monday of this week
    const monday = new Date(date);
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    monday.setDate(monday.getDate() + daysToMonday);
    
    const weekKey = monday.toISOString().slice(0, 10);
    weekMap.set(weekKey, (weekMap.get(weekKey) || 0) + shift.net_minutes);
  }
  
  // Calculate extras per week
  const contractMinutesPerWeek = contractHours * 60;
  let totalExtras = 0;
  
  for (const workedMinutes of weekMap.values()) {
    totalExtras += Math.max(0, workedMinutes - contractMinutesPerWeek);
  }
  
  return totalExtras;
}

/**
 * SSOT UNIQUE: Compute R-Extra balance for employees
 * 
 * Formule: RExtra = detected - paid - consumed (all-time, not per month)
 * 
 * @param client - Supabase admin client
 * @param establishmentId - ID de l'établissement
 * @param userIds - Liste des user_id à calculer
 * @returns Map userId → minutes disponibles
 */
export async function computeRextraBalanceForUsers(
  client: AnyClient,
  establishmentId: string,
  userIds: string[]
): Promise<Record<string, number>> {
  if (userIds.length === 0) {
    return {};
  }
  
  const result: Record<string, number> = {};
  
  // Initialize all users with zero
  for (const userId of userIds) {
    result[userId] = 0;
  }
  
  // 1. Fetch ALL planning shifts (all-time)
  const { data: shifts } = await client
    .from("planning_shifts")
    .select("user_id, shift_date, net_minutes")
    .eq("establishment_id", establishmentId)
    .in("user_id", userIds);
  
  // 2. Fetch employee contracts for hourly rate and contract hours
  const { data: contracts } = await client
    .from("employee_details")
    .select("user_id, contract_hours, total_salary")
    .in("user_id", userIds);
  
  const contractMap = new Map<string, { contractHours: number; totalSalary: number }>();
  for (const c of contracts || []) {
    contractMap.set(c.user_id, {
      contractHours: c.contract_hours || 35,
      totalSalary: c.total_salary || 0,
    });
  }
  
  // 3. Fetch ALL approved extra_events (badge extras, all-time)
  const { data: extraEvents } = await client
    .from("extra_events")
    .select("user_id, extra_minutes")
    .eq("establishment_id", establishmentId)
    .eq("status", "approved")
    .in("user_id", userIds);
  
  // 4. Fetch ALL payroll validations (extras_paid_eur, all-time)
  const { data: validations } = await client
    .from("payroll_employee_month_validation")
    .select("user_id, year_month, extras_paid_eur")
    .eq("establishment_id", establishmentId)
    .in("user_id", userIds);
  
  // 5. Fetch ALL R-Extra consumed (planning_rextra_events, all-time)
  const { data: rextraEvents } = await client
    .from("planning_rextra_events")
    .select("user_id, minutes")
    .eq("establishment_id", establishmentId)
    .in("user_id", userIds);
  
  // Group shifts by user
  const shiftsByUser = new Map<string, Array<{ shift_date: string; net_minutes: number }>>();
  for (const shift of shifts || []) {
    if (!shiftsByUser.has(shift.user_id)) {
      shiftsByUser.set(shift.user_id, []);
    }
    shiftsByUser.get(shift.user_id)!.push(shift);
  }
  
  // Calculate balance for each user
  for (const userId of userIds) {
    const userContract = contractMap.get(userId) || { contractHours: 35, totalSalary: 0 };
    const userShifts = shiftsByUser.get(userId) || [];
    
    // === 1. DETECTED: Planning extras (weekly calculation) ===
    const planningExtras = calculateWeeklyExtras(userShifts, userContract.contractHours);
    
    // === 2. DETECTED: Badge extras ===
    const badgeExtras = (extraEvents || [])
      .filter((e) => e.user_id === userId)
      .reduce((sum, e) => sum + (e.extra_minutes || 0), 0);
    
    const detectedMinutes = planningExtras + badgeExtras;
    
    // === 3. PAID: Convert € to minutes ===
    const monthlyHours = userContract.contractHours * WEEKS_PER_MONTH;
    const hourlyRate = monthlyHours > 0 ? userContract.totalSalary / monthlyHours : 0;
    
    let paidMinutes = 0;
    const userValidations = (validations || []).filter((v) => v.user_id === userId);
    for (const v of userValidations) {
      if (v.extras_paid_eur != null && v.extras_paid_eur > 0 && hourlyRate > 0) {
        paidMinutes += Math.round((v.extras_paid_eur / hourlyRate) * 60);
      }
    }
    
    // === 4. CONSUMED: R-Extra events ===
    const consumedMinutes = (rextraEvents || [])
      .filter((e) => e.user_id === userId)
      .reduce((sum, e) => sum + (e.minutes || 0), 0);
    
    // === FORMULA: RExtra = detected - paid - consumed ===
    result[userId] = Math.max(0, detectedMinutes - paidMinutes - consumedMinutes);
  }
  
  return result;
}

/**
 * DEPRECATED: Legacy function name, use computeRextraBalanceForUsers instead
 * Kept for backward compatibility during transition
 */
export async function computeRextraBalanceForMonth(
  client: AnyClient,
  establishmentId: string,
  _yearMonth: string, // Ignored - we calculate all-time now
  userIds: string[]
): Promise<Record<string, number>> {
  return computeRextraBalanceForUsers(client, establishmentId, userIds);
}

/**
 * Get year-month from week start date
 * Uses the week's Sunday to determine the month (same as payroll)
 */
export function getYearMonthFromWeekStart(weekStart: string): string {
  const monday = new Date(weekStart + "T12:00:00Z");
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, "0")}`;
}
