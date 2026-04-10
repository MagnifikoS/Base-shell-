/**
 * PAYROLL PREP TYPES — Types locaux UI-only
 * 
 * Ces types définissent les données éditables localement (non persistées).
 */

/**
 * Données éditables par salarié (UI-only, state local)
 */
export interface EmployeeLocalEdits {
  /** Heures hebdo (pré-rempli depuis contrat, modifiable) */
  hoursWeekly: number | null;
  /** Heures mensuelles (pré-rempli depuis calcul, modifiable) */
  hoursMonthly: number | null;
  /** Nature de l'absence (UI-only) */
  absenceNature: string;
  /** Remarque libre par salarié */
  remark: string;
  /** Divers - Montant */
  diversAmount: string;
  /** Divers - Nature */
  diversNature: string;
}

/**
 * State local pour toutes les éditions UI-only
 */
export interface LocalEditsState {
  /** Map userId -> éditions locales */
  byEmployee: Record<string, EmployeeLocalEdits>;
}

/**
 * Valeurs par défaut pour un salarié
 */
export function createDefaultEdits(
  contractHoursWeekly: number | null
): EmployeeLocalEdits {
  const weekly = contractHoursWeekly ?? null;
  // Calcul heures mensuelles : hebdo × 52 / 12 (standard légal)
  const monthly = weekly !== null ? Math.round((weekly * 52 / 12) * 100) / 100 : null;
  
  return {
    hoursWeekly: weekly,
    hoursMonthly: monthly,
    absenceNature: "",
    remark: "",
    diversAmount: "",
    diversNature: "",
  };
}
