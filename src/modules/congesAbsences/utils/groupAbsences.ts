/**
 * Utility to group consecutive absence days into visual ranges
 *
 * IMPORTANT: This is UI ONLY - no business logic
 * The grouping is purely for display purposes
 * SSOT remains personnel_leaves with one row per day
 *
 * Rules:
 * - Days are consecutive if they follow each other (01, 02, 03)
 * - Non-consecutive days create separate groups (01, 03, 04 → [01], [03-04])
 * - Each group shares the same source type (planned vs detected)
 *
 * V2: Supports UnifiedAbsenceRecord with source distinction
 */

import type { AbsenceRecord, AbsenceGroup, UnifiedAbsenceRecord } from "../types";

/**
 * Unified absence group for employee view (planned + detected)
 */
export interface UnifiedAbsenceGroup {
  /** Unique ID for React key (first absence ID) */
  id: string;
  /** Start date YYYY-MM-DD */
  dateStart: string;
  /** End date YYYY-MM-DD (same as dateStart if single day) */
  dateEnd: string;
  /** All individual absence records in this group */
  days: UnifiedAbsenceRecord[];
  /** Source type: "planned" or "detected" */
  source: "planned" | "detected";
  /** Leave type for planned absences */
  leaveType?: "cp" | "absence" | "repos" | "am";
  /** Common reason (from first day, only for planned) */
  reason: string | null;
  /** True if all days have justificatif (only for planned) */
  hasJustificatif: boolean;
  /** True if any day is missing justificatif (only for planned) */
  hasMissingJustificatif: boolean;
  /** Number of days in this group */
  dayCount: number;
  /** Total shift minutes (only for detected) */
  totalShiftMinutes?: number;
}

/**
 * Check if two dates are consecutive
 */
function areConsecutive(date1: string, date2: string): boolean {
  const d1 = new Date(date1 + "T12:00:00Z");
  const d2 = new Date(date2 + "T12:00:00Z");
  const diffMs = d2.getTime() - d1.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays === 1;
}

/**
 * Group consecutive absence days into ranges (legacy format)
 *
 * @param absences - Raw absence records from DB (one per day)
 * @returns Grouped absences for UI display
 */
export function groupConsecutiveAbsences(absences: AbsenceRecord[]): AbsenceGroup[] {
  if (absences.length === 0) return [];

  // Sort by date ascending
  const sorted = [...absences].sort((a, b) => a.leave_date.localeCompare(b.leave_date));

  const groups: AbsenceGroup[] = [];
  let currentGroup: AbsenceRecord[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevDate = sorted[i - 1].leave_date;
    const currDate = sorted[i].leave_date;

    if (areConsecutive(prevDate, currDate)) {
      // Add to current group
      currentGroup.push(sorted[i]);
    } else {
      // Finalize current group and start new one
      groups.push(createGroup(currentGroup));
      currentGroup = [sorted[i]];
    }
  }

  // Don't forget the last group
  if (currentGroup.length > 0) {
    groups.push(createGroup(currentGroup));
  }

  return groups;
}

/**
 * Create a group from an array of consecutive days (legacy format)
 */
function createGroup(days: AbsenceRecord[]): AbsenceGroup {
  const first = days[0];
  const last = days[days.length - 1];

  return {
    id: first.id,
    dateStart: first.leave_date,
    dateEnd: last.leave_date,
    days,
    reason: first.reason,
    hasJustificatif: days.every((d) => d.has_justificatif),
    hasMissingJustificatif: days.some((d) => !d.has_justificatif),
    dayCount: days.length,
  };
}

/**
 * Group unified absences into ranges by source type
 * Groups are split when:
 * - Dates are not consecutive
 * - Source changes (planned vs detected)
 *
 * @param absences - Unified absence records (planned + detected)
 * @returns Grouped absences for UI display
 */
export function groupUnifiedAbsences(absences: UnifiedAbsenceRecord[]): UnifiedAbsenceGroup[] {
  if (absences.length === 0) return [];

  // Sort by date ascending (for grouping)
  const sorted = [...absences].sort((a, b) => a.leave_date.localeCompare(b.leave_date));

  const groups: UnifiedAbsenceGroup[] = [];
  let currentGroup: UnifiedAbsenceRecord[] = [sorted[0]];
  let currentSource = sorted[0].source;

  for (let i = 1; i < sorted.length; i++) {
    const prevDate = sorted[i - 1].leave_date;
    const currDate = sorted[i].leave_date;
    const currSource = sorted[i].source;

    // Group only if consecutive AND same source
    if (areConsecutive(prevDate, currDate) && currSource === currentSource) {
      currentGroup.push(sorted[i]);
    } else {
      // Finalize current group and start new one
      groups.push(createUnifiedGroup(currentGroup));
      currentGroup = [sorted[i]];
      currentSource = currSource;
    }
  }

  // Don't forget the last group
  if (currentGroup.length > 0) {
    groups.push(createUnifiedGroup(currentGroup));
  }

  // Sort groups by date descending (most recent first)
  groups.sort((a, b) => b.dateStart.localeCompare(a.dateStart));

  return groups;
}

/**
 * Create a unified group from an array of consecutive days
 */
function createUnifiedGroup(days: UnifiedAbsenceRecord[]): UnifiedAbsenceGroup {
  const first = days[0];
  const last = days[days.length - 1];

  const totalShiftMinutes = days.reduce((acc, d) => acc + (d.shift_minutes || 0), 0);

  return {
    id: first.id,
    dateStart: first.leave_date,
    dateEnd: last.leave_date,
    days,
    source: first.source,
    leaveType: first.leave_type,
    reason: first.reason,
    hasJustificatif: days.every((d) => d.has_justificatif),
    hasMissingJustificatif: days.some((d) => !d.has_justificatif),
    dayCount: days.length,
    totalShiftMinutes: totalShiftMinutes > 0 ? totalShiftMinutes : undefined,
  };
}
