/**
 * Types du module Planning
 * Source de vérité unique pour les interfaces
 */

export interface PlanningShift {
  id: string;
  user_id: string;
  shift_date: string; // YYYY-MM-DD
  start_time: string; // HH:mm
  end_time: string;   // HH:mm
  net_minutes: number;
  break_minutes: number;
  updated_at: string;
}

export interface PlanningEmployee {
  user_id: string;
  full_name: string | null;
  status: "active" | "disabled";
  team_id: string | null;
  team_name: string | null;
}

export interface PlanningTeam {
  id: string;
  name: string;
}

export interface PlanningDayPart {
  start_time: string;
  end_time: string;
  color: string;
}

export interface PlanningDayParts {
  morning: PlanningDayPart;
  midday: PlanningDayPart;
  evening: PlanningDayPart;
}

export interface PlanningOpeningWindow {
  open_time: string;
  close_time: string;
  isClosed: boolean;
}

export interface PlanningValidation {
  weekValidated: boolean;
  validatedDays: Record<string, boolean>;
  /** Manager override: if non-null, week is HIDDEN regardless of auto-publish or week_validated */
  weekInvalidatedAt: string | null;
  /** True if auto-publish is active for this week (Sunday threshold passed) */
  autoPublishActive?: boolean;
}

export interface PlanningEstablishment {
  id: string;
  name: string;
}

export interface PlanningWeekData {
  weekStart: string;
  weekEnd: string;
  timezone: string;
  establishment: PlanningEstablishment;
  teams: PlanningTeam[];
  employees: PlanningEmployee[];
  shiftsByEmployee: Record<string, PlanningShift[]>;
  totalsByEmployee: Record<string, number>;
  validation: PlanningValidation;
  dayParts: PlanningDayParts;
  openingByDate: Record<string, PlanningOpeningWindow>;
  /** PHASE 1 R-EXTRA: Map of R.Extra events by employee and date */
  rextraByEmployeeByDate?: Record<string, Record<string, number>>;
  /** PHASE 2 R-EXTRA: Calculated balances (SSOT on-the-fly) */
  rextraBalanceByEmployee?: Record<string, number>;
  /** 
   * EMPLOYEE NO-NAVIGATION: Which week the employee should see
   * - null for managers (they can navigate freely)
   * - YYYY-MM-DD for employees (current or next week based on visibility rules)
   */
  employeeWeekStart?: string | null;
}

// Groupement par team pour l'affichage
export interface EmployeesByTeam {
  teamId: string | null;
  teamName: string | null;
  employees: PlanningEmployee[];
}
