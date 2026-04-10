/**
 * Types for Congés & Absences module
 */

export interface AbsenceDeclaration {
  date_start: string; // YYYY-MM-DD
  date_end: string; // YYYY-MM-DD
  motif_type: "maladie" | "cp" | "autre";
  motif_detail?: string;
}

/**
 * Base absence record from personnel_leaves
 */
export interface AbsenceRecord {
  id: string;
  leave_date: string;
  reason: string | null;
  has_justificatif: boolean;
  created_at: string;
}

/**
 * Unified absence record for employee view
 * Combines planned (personnel_leaves) and detected (badgeuse) absences
 */
export interface UnifiedAbsenceRecord {
  id: string;
  leave_date: string;
  /** "planned" = declared/approved, "detected" = badgeuse (no clock_in) */
  source: "planned" | "detected";
  /** Type of planned absence (only for source=planned) */
  leave_type?: "cp" | "absence" | "repos" | "am";
  /** Reason text (only for source=planned) */
  reason: string | null;
  /** Has justificatif uploaded (only for source=planned) */
  has_justificatif: boolean;
  /** Shift info (only for source=detected) */
  shift_start?: string;
  shift_end?: string;
  shift_minutes?: number;
}

export interface DeclareAbsenceResponse {
  success: boolean;
  dates: string[];
  require_justificatif: boolean;
}

export interface ListAbsencesResponse {
  absences: AbsenceRecord[];
}

export interface UploadJustificatifResponse {
  success: boolean;
  document_id: string;
}

/**
 * Grouped absence range for UI display (consecutive days)
 */
export interface AbsenceGroup {
  /** Unique ID for React key (first absence ID) */
  id: string;
  /** Start date YYYY-MM-DD */
  dateStart: string;
  /** End date YYYY-MM-DD (same as dateStart if single day) */
  dateEnd: string;
  /** All individual absence records in this group */
  days: AbsenceRecord[];
  /** Common reason (from first day) */
  reason: string | null;
  /** True if all days have justificatif */
  hasJustificatif: boolean;
  /** True if any day is missing justificatif */
  hasMissingJustificatif: boolean;
  /** Number of days in this group */
  dayCount: number;
}
