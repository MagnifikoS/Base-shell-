/**
 * PAYROLL ENGINE — Pure computation functions
 *
 * This file contains ONLY pure functions for payroll calculations.
 * No React, no fetch, no Supabase, no side effects.
 *
 * RULES:
 * - Monthly hours = weekly contract hours × 4.33
 * - Hourly rate = gross salary / monthly hours
 * - Absence = 7h/day = 420 minutes (fixed rule)
 * - Extras = only status === "approved"
 * - Time deductions = late + early departure (always applied)
 * - All currency amounts in €
 * - All durations in minutes (display formatted separately)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🛑 PLANNING EXTRAS SSOT (Code du Travail — Calcul Hebdomadaire)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * RÈGLE: Les heures supplémentaires planning sont calculées PAR SEMAINE CIVILE
 *        (lundi → dimanche), puis agrégées sur le mois.
 *
 * RATTACHEMENT: Chaque semaine appartient au mois de son DIMANCHE.
 *               Une semaine n'est JAMAIS découpée entre deux mois.
 *
 * FORMULE:
 *   Pour chaque semaine rattachée au mois:
 *     extra_semaine = max(0, heures_travaillées_semaine - contract_hours)
 *   planningExtraMinutesMonth = sum(extra_semaine)
 *
 * ❌ ANCIENNE FORMULE (NON-CONFORME, NE PLUS UTILISER):
 *   planningExtraMinutesMonth = max(0, workedMinutesMonth - baseMinutesMonth)
 *
 * DONNÉES INFORMATIVES (affichage uniquement, PAS pour calcul extras):
 *   - workedMinutesMonth: somme mensuelle des net_minutes (pour colonne "H. eff.")
 *   - baseMinutesMonth: contract_hours × WEEKS_PER_MONTH × 60 (pour colonne "Base")
 *
 * @see /docs/payroll-extras-contract.md
 * @see memory/technical/payroll-engine-architecture
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Fixed daily work hours for absence calculation (7h = 420 min) */
export const DAILY_WORK_MINUTES = 420;

/** Conversion factor: weeks per month (exact French labor law: 52/12) */
export const WEEKS_PER_MONTH = 52 / 12;

// ─────────────────────────────────────────────────────────────────────────────
// Currency Rounding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Round currency amount to 2 decimal places (centimes)
 * @param amount - Amount in €
 * @returns Rounded amount (e.g., 17.776666 → 17.78)
 */
export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EmployeeContract {
  /** Gross salary in € (monthly, as entered in employee_details) */
  gross_salary: number;
  /** Net salary in € (monthly, as entered in employee_details) */
  net_salary: number;
  /** Weekly contract hours (e.g., 35 or 39) */
  contract_hours: number;
  /** CP N-1 : reliquat année précédente (transitoire) */
  cp_n1: number | null;
  /** CP N : droits année en cours (transitoire) */
  cp_n: number | null;
  /** Salaire total mensuel (net + espèces). SSOT pour le calcul espèces. */
  total_salary: number | null;
}

export interface ExtraEventLite {
  /** Duration in minutes */
  extra_minutes: number;
  /** Validation status */
  status: "pending" | "approved" | "rejected";
}

/**
 * Raw shift data for weekly extras calculation
 * Hook provides raw data, engine does the weekly grouping
 */
export interface PlanningShiftRaw {
  /** Date of the shift (YYYY-MM-DD) */
  shift_date: string;
  /** Net minutes worked */
  net_minutes: number;
}

export interface PayrollEmployeeInputs {
  /** Employee contract data */
  contract: EmployeeContract;
  /** Extra time events for the period */
  extraEvents: ExtraEventLite[];
  /** Number of CP (congés payés) days */
  cpDays: number;
  /** Number of declared absence days (from personnel_leaves) */
  absenceDeclaredDays: number;
  /** Number of badge-derived absence days (shifts finished without clock_in) */
  absenceBadgeDays: number;
  /** Total late minutes for the period (from badge_events) */
  lateMinutesTotal: number;
  /** Total early departure minutes (SSOT: badge_events.early_departure_minutes) */
  earlyDepartureMinutesTotal: number;
  /**
   * Total worked minutes from planning (net_minutes sum) - INFORMATIVE ONLY
   * ❌ DO NOT use for extras calculation (use shiftsRaw + targetMonth instead)
   * ✅ Used for display column "H. eff." only
   */
  workedMinutesMonth: number;
  /**
   * Raw shifts with week-bounded fetch window (for hebdo extras calculation)
   * Engine will group by week and calculate extras per week
   * @see /docs/payroll-extras-contract.md
   */
  shiftsRaw?: PlanningShiftRaw[];
  /**
   * Target month (YYYY-MM) for filtering weeks by Sunday
   * Required when shiftsRaw is provided
   */
  targetMonth?: string;
  /** CP balances from cp.compute.ts */
  cpBalances?: { cpRemainingN1: number; cpRemainingN: number };
}

/**
 * SSOT EXTRAS:
 * - totalExtraMinutesMonth / totalExtraAmount = badge + planning (utilisés pour totaux et salaire total ajusté)
 * - extraMinutes / extraAmount = badge-only (conservés uniquement pour afficher le détail "Badge vs Planning" dans le drawer)
 *
 * PHASE 2 - SALAIRE TOTAL AJUSTÉ:
 * - hourlyRateOperational = total_salary / monthlyHours (SSOT pour conversions €)
 * - adjustedTotalSalary remplace adjustedGross (base = total_salary, pas brut)
 * - Charges patronales = brut - net (FIXES, jamais recalculées)
 */
export interface PayrollEmployeeLine {
  /** Monthly hours from contract (weekly × WEEKS_PER_MONTH) */
  monthlyHours: number;
  /**
   * Hourly rate OPERATIONAL = total_salary / monthlyHours
   * SSOT for all € conversions: extras, absences, deductions
   * @see PHASE 2 - Salaire total ajusté
   */
  hourlyRateOperational: number;
  /**
   * @deprecated Use hourlyRateOperational for € conversions
   * Kept for backward compatibility, now equals hourlyRateOperational
   */
  hourlyRate: number;
  /** Hourly rate WITH CASH ((gross + cash) / monthly hours) - used ONLY for forecast/% */
  hourlyRateWithCash: number;
  /** Employer charges FIXED (gross - net) - NEVER recalculated based on adjustments */
  chargesFixed: number;
  /** @deprecated Use chargesFixed instead */
  charges: number;
  /** Total approved extra minutes (from badge events only) - used for drawer detail only */
  extraMinutes: number;
  /** Extra amount in € (badge only) - used for drawer detail only */
  extraAmount: number;
  /** Number of CP days */
  cpDays: number;
  /** CP minutes (days × 420) */
  cpMinutes: number;
  /** SSOT: Number of declared absence days (from personnel_leaves) */
  absenceDeclaredDays: number;
  /** SSOT: Number of badge-derived absence days (shifts finished without clock_in) */
  absenceBadgeDays: number;
  /** SSOT: Total absence days = declared + badge */
  absenceDaysTotal: number;
  /** Absence minutes (days × 420) based on absenceDaysTotal */
  absenceMinutes: number;
  /** Absence deduction in € (based on hourlyRateOperational × absenceMinutes) */
  absenceAmount: number;
  /** Total late minutes */
  lateMinutesTotal: number;
  /** Total early departure minutes */
  earlyDepartureMinutesTotal: number;
  /** Combined deduction minutes (late + early departure) */
  timeDeductionMinutes: number;
  /** Time deduction amount in € (based on hourlyRateOperational) */
  timeDeductionAmount: number;
  /** Original gross salary from contract */
  gross_salary: number;
  /** Original net salary from contract */
  net_salary: number;
  /** Total salary from contract (net + espèces) - BASE FOR ADJUSTMENTS */
  totalSalary: number;
  /** Cash amount computed: totalSalary - net_salary (display only, NOT added to totals) */
  cashAmountComputed: number;
  /** Total worked minutes from planning_shifts (sum of net_minutes) */
  workedMinutesMonth: number;
  /**
   * CP N-1 from contract (transitoire)
   * @todo BIZ-PAY-011: Placeholder — populate from CP balance tracking when implemented
   */
  cpN1?: number;
  /**
   * CP N from contract (transitoire)
   * @todo BIZ-PAY-011: Placeholder — populate from CP balance tracking when implemented
   */
  cpN?: number;
  /**
   * Remaining CP N-1 after consumption this month
   * @todo BIZ-PAY-011: Placeholder — populate from CP balance tracking when implemented
   */
  cpRemainingN1?: number;
  /**
   * Remaining CP N after consumption this month
   * @todo BIZ-PAY-011: Placeholder — populate from CP balance tracking when implemented
   */
  cpRemainingN?: number;
  /** Base monthly minutes from contract (contract_hours × WEEKS_PER_MONTH × 60) */
  baseMinutesMonth: number;
  /** Extra minutes from planning (weekly calculation) */
  planningExtraMinutesMonth: number;
  /** SSOT: Total extra minutes = badge + planning */
  totalExtraMinutesMonth: number;
  /** SSOT: Total extra amount in € (based on hourlyRateOperational) */
  totalExtraAmount: number;
}

/**
 * PHASE 2 - SALAIRE TOTAL AJUSTÉ
 *
 * Nouvelles sémantiques:
 * - totalMassToDisburse = Σ(salaire total ajusté) = ce qu'on paie réellement
 * - totalChargesFixed = Σ(brut - net) = charges fixes, jamais recalculées
 * - totalPayrollMass = totalMassToDisburse + totalChargesFixed
 *
 * ⚠️ PAS DE DOUBLE COMPTAGE: on n'ajoute JAMAIS cashAmount séparément
 * car totalSalary inclut déjà les espèces.
 */
export interface PayrollTotals {
  /** Sum of all gross_salary (for reference only) */
  totalGrossBase: number;
  /** Sum of all net_salary */
  totalNetBase: number;
  /** Sum of all totalExtraAmount (for reference) */
  totalExtras: number;
  /** Total CP days (informational, not deducted) */
  totalCpDays: number;
  /** Sum of all absenceAmount (non-CP absences only) */
  totalAbsences: number;
  /** Sum of all timeDeductionAmount */
  totalDeductions: number;

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2 - NOUVEAUX TOTAUX (Salaire Total Ajusté)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * SSOT: Masse totale à verser = Σ(salaire total ajusté)
   * C'est la somme réelle "à payer" après ajustements validés.
   * Remplace l'ancien totalNetWithCash.
   */
  totalMassToDisburse: number;

  /**
   * SSOT: Charges patronales FIXES = Σ(brut - net)
   * Ne dépend PAS des ajustements (extras/absences/deductions).
   */
  totalChargesFixed: number;

  /**
   * SSOT: Masse salariale totale = totalMassToDisburse + totalChargesFixed
   * Coût total employeur (versements + charges).
   */
  totalPayrollMass: number;

  /**
   * Sum of all cashAmountComputed (for display in drawer only)
   * ⚠️ NE PAS utiliser dans les totaux car déjà inclus dans totalSalary
   */
  totalCashAmount: number;

  // ═══════════════════════════════════════════════════════════════════════════
  // DEPRECATED - Kept for backward compatibility during migration
  // ═══════════════════════════════════════════════════════════════════════════

  /** @deprecated Use totalMassToDisburse instead */
  totalGrossAdjusted: number;
  /** @deprecated Use totalChargesFixed instead */
  remainingToPay: number;
  /** @deprecated Use totalMassToDisburse instead */
  totalGrossAdjustedValidated: number;
  /** @deprecated Use totalMassToDisburse instead */
  totalGrossDisplayed: number;
  /** @deprecated Use totalChargesFixed instead */
  remainingToPayDisplayed: number;
  /** @deprecated Use totalMassToDisburse instead (already includes cash) */
  totalNetWithCash: number;
  /** @deprecated Use totalPayrollMass instead */
  totalGrossWithCash: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Flags (for payroll_employee_month_validation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validation flags for a single employee-month
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SSOT UNIQUE: R-EXTRA CALCULÉ ON-THE-FLY
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * R-Extra est calculé dynamiquement, JAMAIS stocké.
 * Formule unique: RExtra = detected - paid - consumed (all-time)
 *
 * La seule donnée persistée est:
 *   - extras_paid_eur: montant € payé sur salaire (NULL = 0€ payé)
 *
 * ❌ SUPPRIMÉ: extras_deferred_minutes (logique de report N→N+1)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface PayrollValidationFlags {
  includeExtras: boolean;
  includeAbsences: boolean;
  includeDeductions: boolean;
  cashPaid: boolean;
  netPaid: boolean;
  /** Montant € payé sur salaire pour les extras (NULL = 0€) */
  extrasPaidEur: number | null;
  /** Montant € versé par virement (null = totalité si netPaid=true, ou non payé si netPaid=false) */
  netAmountPaid: number | null;
  /** Montant € versé en espèces (null = totalité si cashPaid=true, ou non payé si cashPaid=false) */
  cashAmountPaid: number | null;
}

/**
 * Default validation flags (nothing included until explicitly validated)
 */
export const DEFAULT_VALIDATION_FLAGS: PayrollValidationFlags = {
  includeExtras: false,
  includeAbsences: false,
  includeDeductions: false,
  cashPaid: false,
  netPaid: false,
  extrasPaidEur: null,
  netAmountPaid: null,
  cashAmountPaid: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Core Computation Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert weekly contract hours to monthly hours
 * @param contractHoursWeekly - Weekly hours (e.g., 35, 39)
 * @returns Monthly hours (e.g., 39 → 169)
 */
export function computeMonthlyHours(contractHoursWeekly: number): number {
  if (!Number.isFinite(contractHoursWeekly) || contractHoursWeekly <= 0) return 0;
  return contractHoursWeekly * WEEKS_PER_MONTH;
}

/**
 * Calculate hourly rate OPERATIONAL = total_salary / monthlyHours
 *
 * PHASE 2 - SSOT for all € conversions:
 * - Extras (badge + planning)
 * - Absences
 * - Retards + Départs anticipés
 *
 * @param totalSalary - Monthly total salary in € (net + espèces)
 * @param monthlyHours - Monthly hours
 * @returns Operational hourly rate in €
 */
export function computeHourlyRateOperational(totalSalary: number, monthlyHours: number): number {
  if (monthlyHours <= 0) return 0;
  return totalSalary / monthlyHours;
}

/**
 * @deprecated Use computeHourlyRateOperational instead
 * Kept for backward compatibility
 */
export function computeHourlyRate(grossSalary: number, monthlyHours: number): number {
  if (monthlyHours <= 0) return 0;
  return grossSalary / monthlyHours;
}

/**
 * Calculate employer charges FIXED (cotisations patronales)
 *
 * PHASE 2: These charges are FIXED and never recalculated based on adjustments.
 * Extras do NOT generate additional charges in our model.
 *
 * @param grossSalary - Monthly gross salary in €
 * @param netSalary - Monthly net salary in €
 * @returns Fixed charges in € (always >= 0)
 */
export function computeChargesFixed(grossSalary: number, netSalary: number): number {
  if (!Number.isFinite(grossSalary) || !Number.isFinite(netSalary)) return 0;
  return Math.max(0, grossSalary - netSalary);
}

/** @deprecated Use computeChargesFixed instead */
export function computeCharges(grossSalary: number, netSalary: number): number {
  return computeChargesFixed(grossSalary, netSalary);
}

/**
 * Calculate hourly rate WITH cash component (for forecast/previsionnel only)
 * Formula: (gross + cash) / monthlyHours
 *
 * This rate is used ONLY for:
 * - Forecast mass (masse salariale prévisionnelle)
 * - Department percentages
 *
 * NOT used for: extras, absences, retards (use computeHourlyRateOperational instead)
 *
 * @param grossSalary - Monthly gross salary in €
 * @param cashAmount - Computed cash amount (total_salary - net_salary)
 * @param monthlyHours - Monthly hours
 * @returns Hourly rate with cash in €
 */
export function computeHourlyRateWithCash(
  grossSalary: number,
  cashAmount: number,
  monthlyHours: number
): number {
  if (monthlyHours <= 0) return 0;
  return (grossSalary + cashAmount) / monthlyHours;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly Planning Extras (Code du Travail)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🛑 SSOT PLANNING EXTRAS — Calcul Hebdomadaire (Code du Travail)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Calcule les heures supplémentaires planning PAR SEMAINE CIVILE (lundi→dimanche),
 * puis agrège uniquement les semaines rattachées au mois cible.
 *
 * RATTACHEMENT: Chaque semaine appartient au mois de son DIMANCHE.
 * Une semaine n'est JAMAIS découpée entre deux mois.
 *
 * @param shiftsRaw - Liste des shifts bruts avec shift_date + net_minutes
 * @param targetMonth - Mois cible au format "YYYY-MM"
 * @param contractHoursWeekly - Heures hebdomadaires contractuelles (ex: 35)
 * @returns Total des extras planning en minutes pour le mois
 *
 * @see /docs/payroll-extras-contract.md
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function computePlanningExtrasWeekly(
  shiftsRaw: PlanningShiftRaw[],
  targetMonth: string, // "YYYY-MM"
  contractHoursWeekly: number
): number {
  if (!shiftsRaw || shiftsRaw.length === 0 || contractHoursWeekly <= 0) {
    return 0;
  }

  const baseMinutesWeekly = contractHoursWeekly * 60;

  // Group shifts by week (week key = YYYY-MM-DD of monday)
  const shiftsByWeek = new Map<
    string,
    {
      sundayMonth: string;
      totalMinutes: number;
    }
  >();

  for (const shift of shiftsRaw) {
    // Parse shift date
    const [year, month, day] = shift.shift_date.split("-").map(Number);
    const shiftDate = new Date(year, month - 1, day);

    // Find the Monday of this week
    const dayOfWeek = shiftDate.getDay(); // 0=dim, 1=lun, ..., 6=sam
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(shiftDate);
    monday.setDate(shiftDate.getDate() - daysToMonday);

    // Find the Sunday of this week
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    // Week key = Monday date
    const weekKey = formatDateYYYYMMDD(monday);

    // Month of Sunday (rattachement)
    const sundayMonth = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, "0")}`;

    // Aggregate
    const existing = shiftsByWeek.get(weekKey);
    if (existing) {
      existing.totalMinutes += shift.net_minutes || 0;
    } else {
      shiftsByWeek.set(weekKey, {
        sundayMonth,
        totalMinutes: shift.net_minutes || 0,
      });
    }
  }

  // Calculate extras for weeks attached to targetMonth
  let totalExtrasMinutes = 0;

  for (const [, week] of shiftsByWeek) {
    // Only count weeks where Sunday is in target month
    if (week.sundayMonth === targetMonth) {
      const extraThisWeek = Math.max(0, week.totalMinutes - baseMinutesWeekly);
      totalExtrasMinutes += extraThisWeek;
    }
  }

  return totalExtrasMinutes;
}

/**
 * Helper: Format Date to YYYY-MM-DD string
 */
function formatDateYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra Time Functions (Badge)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sum approved extra minutes only (BADGE ONLY)
 * @param extraEvents - Array of extra events
 * @returns Total approved extra minutes
 */
export function computeExtraMinutes(extraEvents: ExtraEventLite[]): number {
  return extraEvents
    .filter((e) => e.status === "approved")
    .reduce((sum, e) => sum + e.extra_minutes, 0);
}

/**
 * Convert extra minutes to € amount (rounded to 2 decimals)
 * @param extraMinutes - Total extra minutes
 * @param hourlyRate - Hourly rate in €
 * @returns Extra amount in € (rounded), 0 if inputs invalid
 */
export function computeExtraAmount(extraMinutes: number, hourlyRate: number): number {
  if (!Number.isFinite(extraMinutes) || !Number.isFinite(hourlyRate)) return 0;
  return roundCurrency((extraMinutes / 60) * hourlyRate);
}

// ─────────────────────────────────────────────────────────────────────────────
// Absence Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert absence days to minutes (fixed 7h/day = 420 min)
 * @param absenceDays - Number of absence days
 * @returns Absence minutes
 */
export function computeAbsenceMinutes(absenceDays: number): number {
  return absenceDays * DAILY_WORK_MINUTES;
}

/**
 * Convert absence minutes to € deduction (rounded to 2 decimals)
 * @param absenceMinutes - Total absence minutes
 * @param hourlyRate - Hourly rate in €
 * @returns Absence deduction in € (rounded)
 */
export function computeAbsenceAmount(absenceMinutes: number, hourlyRate: number): number {
  return roundCurrency((absenceMinutes / 60) * hourlyRate);
}

// ─────────────────────────────────────────────────────────────────────────────
// Time Deduction Functions (Late + Early Departure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Combine late + early departure minutes
 * @param lateMinutesTotal - Total late minutes
 * @param earlyDepartureMinutesTotal - Total early departure minutes
 * @returns Combined deduction minutes
 */
export function computeTimeDeductionMinutes(
  lateMinutesTotal: number,
  earlyDepartureMinutesTotal: number
): number {
  return lateMinutesTotal + earlyDepartureMinutesTotal;
}

/**
 * Convert time deduction minutes to € amount (rounded to 2 decimals)
 * @param deductionMinutes - Total deduction minutes
 * @param hourlyRate - Hourly rate in €
 * @returns Deduction amount in € (rounded)
 */
export function computeTimeDeductionAmount(deductionMinutes: number, hourlyRate: number): number {
  return roundCurrency((deductionMinutes / 60) * hourlyRate);
}

// ─────────────────────────────────────────────────────────────────────────────
// Employee Line Summary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute complete payroll line for one employee
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🛑 PLANNING EXTRAS: Calcul Hebdomadaire (Code du Travail)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Si shiftsRaw + targetMonth sont fournis:
 *   → Utilise computePlanningExtrasWeekly (groupement par semaine civile)
 *   → Rattachement au mois du dimanche
 *
 * Sinon (fallback legacy):
 *   → Utilise workedMinutesMonth - baseMinutesMonth (ancienne formule)
 *
 * workedMinutesMonth et baseMinutesMonth restent calculés pour AFFICHAGE uniquement.
 *
 * @see /docs/payroll-extras-contract.md
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * @param input - All inputs for the employee
 * @returns Complete payroll line with all computed values
 */
export function computePayrollEmployeeLine(input: PayrollEmployeeInputs): PayrollEmployeeLine {
  const {
    contract,
    extraEvents,
    cpDays,
    absenceDeclaredDays,
    absenceBadgeDays,
    lateMinutesTotal,
    earlyDepartureMinutesTotal,
    workedMinutesMonth,
    shiftsRaw,
    targetMonth,
    cpBalances,
  } = input;

  // Step 1: Monthly hours
  const monthlyHours = computeMonthlyHours(contract.contract_hours);

  // Step 2: Total salary and computed cash
  const totalSalary = contract.total_salary ?? contract.net_salary ?? 0;
  const cashAmountComputed = Math.max(0, totalSalary - contract.net_salary);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Hourly Rate OPERATIONAL = total_salary / monthlyHours
  // SSOT for all € conversions (extras, absences, deductions)
  // ═══════════════════════════════════════════════════════════════════════════
  const hourlyRateOperational = computeHourlyRateOperational(totalSalary, monthlyHours);

  // Legacy hourlyRate (now equals hourlyRateOperational for compatibility)
  const hourlyRate = hourlyRateOperational;

  // Step 3: Charges FIXED and hourly rate with cash (for forecast only)
  const chargesFixed = computeChargesFixed(contract.gross_salary, contract.net_salary);
  const charges = chargesFixed; // Deprecated alias
  const hourlyRateWithCash = computeHourlyRateWithCash(
    contract.gross_salary,
    cashAmountComputed,
    monthlyHours
  );

  // Step 4: Base minutes from contract (INFORMATIVE - for display only)
  const baseMinutesMonth = Math.round(monthlyHours * 60);

  // Step 5: Extras from badge events (approved only)
  const extraMinutes = computeExtraMinutes(extraEvents);
  const extraAmount = computeExtraAmount(extraMinutes, hourlyRateOperational);

  // ═══════════════════════════════════════════════════════════════════════════
  // Step 6: Planning extras - WEEKLY CALCULATION (Code du Travail)
  // ═══════════════════════════════════════════════════════════════════════════
  let planningExtraMinutesMonth: number;

  if (shiftsRaw && shiftsRaw.length > 0 && targetMonth) {
    planningExtraMinutesMonth = computePlanningExtrasWeekly(
      shiftsRaw,
      targetMonth,
      contract.contract_hours
    );
  } else {
    if (import.meta.env.DEV) console.warn("Legacy monthly extras formula used — see BIZ-PAY-012");
    planningExtraMinutesMonth = Math.max(0, workedMinutesMonth - baseMinutesMonth);
  }

  // Step 7: Total extras = badge extras + planning extras
  const totalExtraMinutesMonth = extraMinutes + planningExtraMinutesMonth;

  // Step 8: Total extra amount in € (SSOT - using hourlyRateOperational)
  const totalExtraAmount = computeExtraAmount(totalExtraMinutesMonth, hourlyRateOperational);

  // Step 9: CP (congés payés) - counted but NOT deducted from salary
  const cpMinutes = computeAbsenceMinutes(cpDays);

  // Step 10: Absences (non-CP) - using hourlyRateOperational
  const absenceDaysTotal = absenceDeclaredDays + absenceBadgeDays;
  const absenceMinutes = computeAbsenceMinutes(absenceDaysTotal);
  const absenceAmount = computeAbsenceAmount(absenceMinutes, hourlyRateOperational);

  // Step 11: Time deductions - using hourlyRateOperational
  const timeDeductionMinutes = computeTimeDeductionMinutes(
    lateMinutesTotal,
    earlyDepartureMinutesTotal
  );
  const timeDeductionAmount = computeTimeDeductionAmount(
    timeDeductionMinutes,
    hourlyRateOperational
  );

  return {
    monthlyHours,
    hourlyRateOperational,
    hourlyRate,
    hourlyRateWithCash,
    chargesFixed,
    charges,
    extraMinutes,
    extraAmount,
    cpDays,
    cpMinutes,
    absenceDeclaredDays,
    absenceBadgeDays,
    absenceDaysTotal,
    absenceMinutes,
    absenceAmount,
    lateMinutesTotal,
    earlyDepartureMinutesTotal,
    timeDeductionMinutes,
    timeDeductionAmount,
    gross_salary: contract.gross_salary,
    net_salary: contract.net_salary,
    totalSalary,
    cashAmountComputed,
    workedMinutesMonth,
    baseMinutesMonth,
    planningExtraMinutesMonth,
    totalExtraMinutesMonth,
    totalExtraAmount,
    // BIZ-PAY-011: CP balance fields — populated from cpBalances input when available,
    // otherwise undefined (optional fields for future CP balance tracking)
    cpN1: contract.cp_n1 ?? undefined,
    cpN: contract.cp_n ?? undefined,
    cpRemainingN1: cpBalances?.cpRemainingN1,
    cpRemainingN: cpBalances?.cpRemainingN,
  };
}

/**
 * @deprecated Use computeAdjustedTotalSalary instead
 * Compute adjusted total salary (NOT gross) for a single employee
 */
export function computeAdjustedGross(line: PayrollEmployeeLine): number {
  return line.totalSalary + line.totalExtraAmount - line.absenceAmount - line.timeDeductionAmount;
}

/**
 * PHASE 2: Compute "Salaire total ajusté" for a single employee
 * Base = totalSalary (net + espèces)
 * Adjustments use hourlyRateOperational
 *
 * @param line - Computed payroll line
 * @param flags - Validation flags (defaults to nothing included)
 * @returns Adjusted total salary in €
 */
export function computeAdjustedTotalSalary(
  line: PayrollEmployeeLine,
  flags?: PayrollValidationFlags
): number {
  const extras = flags?.includeExtras ? line.totalExtraAmount : 0;
  const absences = flags?.includeAbsences ? line.absenceAmount : 0;
  const deductions = flags?.includeDeductions ? line.timeDeductionAmount : 0;
  return line.totalSalary + extras - absences - deductions;
}

/**
 * @deprecated Use computeAdjustedTotalSalary instead
 */
export function computeAdjustedGrossValidated(
  line: PayrollEmployeeLine,
  flags?: PayrollValidationFlags
): number {
  return computeAdjustedTotalSalary(line, flags);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode-Aware Adjusted Gross (P1.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PHASE 2: Simplified breakdown for "Salaire total ajusté"
 *
 * Base = totalSalary (net + espèces), NOT gross_salary
 * All amounts use hourlyRateOperational
 */
export interface PayrollDueBreakdownSimplified {
  /** Total extra minutes RAW (badge + planning SSOT) */
  extrasMinutesRaw: number;
  /** Total extra amount RAW in € (using hourlyRateOperational) */
  extrasAmountRaw: number;
  /** Current month deduction minutes (late + early departure) */
  deductionMinutesRaw: number;
  /** Current month deduction amount in € (using hourlyRateOperational) */
  deductionAmountRaw: number;
  /** Absences amount in € (using hourlyRateOperational) */
  absencesAmountRaw: number;

  /** Extras amount applied to salary (based on includeExtras flag) */
  extrasAmountForPay: number;
  /** Deduction amount applied to salary (based on includeDeductions flag) */
  deductionAmountForPay: number;
  /** Absences amount applied to salary (based on includeAbsences flag) */
  absencesAmountForPay: number;
  /**
   * PHASE 2: Final "Salaire total ajusté"
   * = totalSalary + extras - absences - deductions
   * (base is totalSalary, NOT gross_salary)
   */
  adjustedGross: number;
}

/**
 * PHASE 2: Compute "Salaire total ajusté" breakdown
 *
 * Base = totalSalary (includes espèces)
 * All € conversions use hourlyRateOperational (total/hours)
 *
 * @param line - Computed payroll line
 * @param flags - Validation flags
 * @returns Complete breakdown with raw and effective amounts
 */
export function computeDueBreakdownSimplified(
  line: PayrollEmployeeLine,
  flags: PayrollValidationFlags | undefined
): PayrollDueBreakdownSimplified {
  const extrasMinutesRaw = line.totalExtraMinutesMonth;
  const extrasAmountRaw = line.totalExtraAmount;
  const deductionMinutesRaw = line.timeDeductionMinutes;
  const deductionAmountRaw = line.timeDeductionAmount;
  const absencesAmountRaw = line.absenceAmount;

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE: PARTIAL EXTRAS PAYMENT
  // If includeExtras = true:
  //   - Use extrasPaidEur if defined (partial payment)
  //   - Otherwise use full amount (extrasAmountRaw)
  // If includeExtras = false:
  //   - No extras paid on salary
  // ═══════════════════════════════════════════════════════════════════════════
  let extrasAmountForPay = 0;
  if (flags?.includeExtras) {
    if (flags.extrasPaidEur !== null && flags.extrasPaidEur !== undefined) {
      // Clamp to [0, extrasAmountRaw] to prevent over-payment
      extrasAmountForPay = Math.max(0, Math.min(flags.extrasPaidEur, extrasAmountRaw));
    } else {
      // NULL = pay full amount
      extrasAmountForPay = extrasAmountRaw;
    }
  }

  const deductionAmountForPay = flags?.includeDeductions ? deductionAmountRaw : 0;
  const absencesAmountForPay = flags?.includeAbsences ? absencesAmountRaw : 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Base = totalSalary (NOT gross_salary)
  // ═══════════════════════════════════════════════════════════════════════════
  const adjustedGross = roundCurrency(
    line.totalSalary + extrasAmountForPay - absencesAmountForPay - deductionAmountForPay
  );

  return {
    extrasMinutesRaw,
    extrasAmountRaw,
    deductionMinutesRaw,
    deductionAmountRaw,
    absencesAmountRaw,
    extrasAmountForPay,
    deductionAmountForPay,
    absencesAmountForPay,
    adjustedGross,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SSOT UNIQUE: R-Extra Calculation (On-the-fly, jamais stocké)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🛑 SSOT UNIQUE: R-EXTRA — Calculé dynamiquement, JAMAIS stocké
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * FORMULE UNIQUE (utilisée partout: Planning + Payroll):
 *   RExtra = total_extras_détectés - total_extras_payés - total_rextra_consommés
 *
 * Ce calcul est effectué par le backend (getWeek.ts / rextraBalance.ts)
 * et retourné dans data.rextraBalanceByEmployee.
 *
 * Cette fonction est conservée pour le calcul local dans le drawer Payroll
 * basé sur les données du mois courant uniquement.
 *
 * ❌ SUPPRIMÉ: extras_deferred_minutes (plus de persistance de solde)
 * ❌ SUPPRIMÉ: logique de report M→M+1 (calcul all-time now)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface RExtraDecision {
  /** Extras détectés ce mois (planning + badge) en minutes */
  detectedMinutes: number;
  /** Extras détectés ce mois en € */
  detectedEur: number;
  /** Montant payé sur salaire en € */
  paidEur: number;
  /** Montant payé converti en minutes */
  paidMinutes: number;
  /** R-Extra = solde disponible en minutes (detected - paid) */
  rExtraMinutes: number;
  /** R-Extra = solde disponible en € */
  rExtraEur: number;
  /** Total disponible en minutes */
  totalAvailableMinutes: number;
  /** Total disponible en € */
  totalAvailableEur: number;
}

/**
 * Compute R-Extra basé sur les extras du mois et le paiement
 *
 * SSOT RULES:
 * - hourlyRateOperational = total_salary / monthlyHours
 * - €→minutes: minutes = (eur / hourlyRateOperational) * 60
 * - minutes→€: eur = (minutes / 60) * hourlyRateOperational
 *
 * @param line - PayrollEmployeeLine from engine
 * @param inputPaidEur - Montant € payé sur salaire (0 si non spécifié)
 */
export function computeRExtraDecision(
  line: PayrollEmployeeLine,
  inputPaidEur: number | null | undefined
): RExtraDecision {
  const hourlyRate = line.hourlyRateOperational;

  // Detected extras this month (SSOT from engine)
  const detectedMinutes = line.totalExtraMinutesMonth;
  const detectedEur = line.totalExtraAmount;

  // Total available = detected (no more carryIn from previous month)
  const totalAvailableMinutes = detectedMinutes;
  const totalAvailableEur = detectedEur;

  // Paid amount (clamp to available)
  const paidEur = Math.max(0, Math.min(inputPaidEur ?? 0, totalAvailableEur));

  // Convert paid € to minutes
  const paidMinutes = hourlyRate > 0 ? Math.round((paidEur / hourlyRate) * 60) : 0;

  // R-Extra = max(0, totalAvailable - paid)
  const rExtraMinutes = Math.max(0, totalAvailableMinutes - paidMinutes);
  const rExtraEur = hourlyRate > 0 ? roundCurrency((rExtraMinutes / 60) * hourlyRate) : 0;

  return {
    detectedMinutes,
    detectedEur,
    paidEur,
    paidMinutes,
    rExtraMinutes,
    rExtraEur,
    totalAvailableMinutes,
    totalAvailableEur,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Payroll Totals Aggregation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Employee data structure for totals computation (userId separate from line)
 */
export interface PayrollEmployeeForTotals {
  userId: string;
  line: PayrollEmployeeLine;
}

/**
 * Aggregate payroll totals from employees with validation support
 * Pure function - keeps userId at data layer, not in PayrollEmployeeLine
 * @param employees - Array of { userId, line } objects
 * @param validationByUserId - Map of userId → validation flags
 * @returns Payroll totals for the entire workforce
 */
export function computePayrollTotalsFromEmployees(
  employees: PayrollEmployeeForTotals[],
  validationByUserId?: Map<string, PayrollValidationFlags>
): PayrollTotals {
  let totalGrossBase = 0;
  let totalNetBase = 0;
  let totalExtras = 0;
  let totalCpDays = 0;
  let totalAbsences = 0;
  let totalDeductions = 0;
  let totalCashAmount = 0;
  let totalChargesFixed = 0;
  let totalMassToDisburse = 0;

  for (const { userId, line } of employees) {
    totalGrossBase += line.gross_salary;
    totalNetBase += line.net_salary;
    totalExtras += line.totalExtraAmount;
    totalCpDays += line.cpDays;
    totalAbsences += line.absenceAmount;
    totalDeductions += line.timeDeductionAmount;
    totalCashAmount += line.cashAmountComputed;
    totalChargesFixed += line.chargesFixed;

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2: Compute "Salaire total ajusté" for this employee
    // Base = totalSalary (includes cash), adjustments based on flags
    // ═══════════════════════════════════════════════════════════════════════
    const flags = validationByUserId?.get(userId);
    let extrasForPay = 0;
    if (flags?.includeExtras) {
      if (flags.extrasPaidEur !== null && flags.extrasPaidEur !== undefined) {
        // BIZ-PAY-010: Respect extrasPaidEur for partial extras (aligned with computeDueBreakdownSimplified)
        extrasForPay = Math.max(0, Math.min(flags.extrasPaidEur, line.totalExtraAmount));
      } else {
        extrasForPay = line.totalExtraAmount;
      }
    }
    const absencesForPay = flags?.includeAbsences ? line.absenceAmount : 0;
    const deductionsForPay = flags?.includeDeductions ? line.timeDeductionAmount : 0;
    const adjustedTotalSalary = line.totalSalary + extrasForPay - absencesForPay - deductionsForPay;
    totalMassToDisburse += adjustedTotalSalary;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: New totals (NO double counting of cash!)
  // ═══════════════════════════════════════════════════════════════════════════

  // Masse salariale totale = Masse à verser + Charges fixes
  const totalPayrollMass = totalMassToDisburse + totalChargesFixed;

  // ═══════════════════════════════════════════════════════════════════════════
  // DEPRECATED: Legacy values for backward compatibility
  // ═══════════════════════════════════════════════════════════════════════════
  const totalGrossAdjusted = totalGrossBase + totalExtras - totalAbsences - totalDeductions;
  const remainingToPay = totalGrossBase - totalNetBase;
  const totalGrossAdjustedValidated = totalMassToDisburse; // Mapped to new value
  const totalGrossDisplayed = totalMassToDisburse;
  const remainingToPayDisplayed = totalChargesFixed;
  const totalNetWithCash = totalMassToDisburse; // Now same as mass to disburse
  const totalGrossWithCash = totalPayrollMass;

  return {
    totalGrossBase,
    totalNetBase,
    totalExtras,
    totalCpDays,
    totalAbsences,
    totalDeductions,
    // PHASE 2 - New fields
    totalMassToDisburse,
    totalChargesFixed,
    totalPayrollMass,
    totalCashAmount,
    // Deprecated (backward compat)
    totalGrossAdjusted,
    remainingToPay,
    totalGrossAdjustedValidated,
    totalGrossDisplayed,
    remainingToPayDisplayed,
    totalNetWithCash,
    totalGrossWithCash,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation Helpers (Phase 2 - UI display support)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sum late minutes from badge events (already tolerance-adjusted)
 * Pure function - no I/O
 * @param events - Array of events with late_minutes
 * @returns Total late minutes
 */
export function sumLateMinutes(events: Array<{ late_minutes: number | null }>): number {
  return events.reduce((sum, e) => sum + (e.late_minutes || 0), 0);
}

/**
 * Sum early departure minutes from DB-stored values
 * SSOT: badge_events.early_departure_minutes (stored at clock_out)
 * @param earlyDepartureMinutes - Array of individual early departure minutes
 * @returns Total early departure minutes
 */
export function sumEarlyDepartureMinutes(earlyDepartureMinutes: number[]): number {
  return earlyDepartureMinutes.reduce((sum, m) => sum + m, 0);
}

/**
 * Compute "Heures à retirer" (late + early departure combined)
 * Single source for UI display in RetardTab
 * @param lateMinutesTotal - Total late minutes
 * @param earlyDepartureMinutesTotal - Total early departure minutes
 * @returns Object with total minutes and formatted HH:MM
 */
export function computeHeuresARetirer(
  lateMinutesTotal: number,
  earlyDepartureMinutesTotal: number
): { totalMinutes: number; hhmm: string } {
  const totalMinutes = lateMinutesTotal + earlyDepartureMinutesTotal;
  return {
    totalMinutes,
    hhmm: formatMinutesToHHMM(totalMinutes),
  };
}

/**
 * Format minutes to HH:MM string (for display only)
 * Pure function - no side effects
 * @param totalMinutes - Total minutes
 * @returns Formatted string "HH:MM" (e.g., "00:45", "02:30")
 */
export function formatMinutesToHHMM(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "00:00";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

/**
 * Count unique CP days from leaves array
 * Only counts approved leaves with type 'cp'
 * @param leaves - Array of leave records with leave_date and leave_type
 * @returns Number of unique CP days
 */
export function countCpDays(
  leaves: Array<{ leave_date: string; leave_type: string; status?: string }>
): number {
  const validLeaves = leaves.filter(
    (l) => (l.status === undefined || l.status === "approved") && l.leave_type === "cp"
  );
  return new Set(validLeaves.map((l) => l.leave_date)).size;
}

// ─────────────────────────────────────────────────────────────────────────────
// Planning Payroll Cost (Phase A1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute planning-based payroll cost for one employee
 * Pure function: netMinutes from planning × hourlyRate from payroll engine
 * @param totalNetMinutes - Sum of net_minutes from planning_shifts
 * @param hourlyRate - Hourly rate from payroll engine (gross / monthly hours)
 * @returns Cost in € (rounded to 2 decimals)
 */
export function computePlanningPayrollCost(totalNetMinutes: number, hourlyRate: number): number {
  if (totalNetMinutes <= 0 || hourlyRate <= 0) return 0;
  return roundCurrency((totalNetMinutes / 60) * hourlyRate);
}

/**
 * Count unique absence days from leaves array
 * Only counts approved leaves with type 'absence' (NOT cp)
 * @param leaves - Array of leave records with leave_date and leave_type
 * @returns Number of unique absence days
 */
export function countAbsenceDays(
  leaves: Array<{ leave_date: string; leave_type: string; status?: string }>
): number {
  const validLeaves = leaves.filter(
    (l) => (l.status === undefined || l.status === "approved") && l.leave_type === "absence"
  );
  return new Set(validLeaves.map((l) => l.leave_date)).size;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Examples (kept as documentation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @example
 * // Employee with 39h/week contract, €3000 gross, 2 absence days
 * const line = computePayrollEmployeeLine({
 *   contract: { gross_salary: 3000, net_salary: 2400, contract_hours: 39 },
 *   extraEvents: [{ extra_minutes: 120, status: "approved" }],
 *   absenceDays: 2,
 *   lateMinutesTotal: 30,
 *   earlyDepartureMinutesTotal: 15,
 * });
 *
 * // line.monthlyHours ≈ 168.87
 * // line.hourlyRate ≈ 17.77
 * // line.extraMinutes = 120 → line.extraAmount ≈ 35.54
 * // line.absenceMinutes = 840 → line.absenceAmount ≈ 248.78
 * // line.timeDeductionMinutes = 45 → line.timeDeductionAmount ≈ 13.33
 *
 * @example
 * // Compute "Heures à retirer" for display
 * const result = computeHeuresARetirer(30, 15);
 * // result.totalMinutes = 45
 * // result.hhmm = "00:45"
 *
 * @example
 * // Count absence days for payroll
 * const days = countAbsenceDays([
 *   { leave_date: "2026-01-10", leave_type: "cp", status: "approved" },
 *   { leave_date: "2026-01-11", leave_type: "absence", status: "approved" },
 *   { leave_date: "2026-01-12", leave_type: "repos", status: "approved" }, // excluded
 * ]);
 * // days = 2 (repos not counted)
 */
