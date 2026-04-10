/**
 * Utility functions for ShiftManagementCore
 * Extracted to reduce main component size
 */

import { ADMIN_TEST_MODE } from "@/config/testModeFlags";

export interface TimeOption {
  value: string;  // Unique: raw minutes as string (e.g., "1560" for 02:00 next day)
  label: string;  // Display: HH:MM format (e.g., "02:00")
}

/**
 * Convert raw minutes value to HH:MM display format
 */
export function minutesToLabel(rawMin: number): string {
  const displayMin = rawMin % 1440;
  const h = Math.floor(displayMin / 60);
  const m = displayMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Convert HH:MM string to raw minutes (for initial values from existing shifts)
 * Handles overnight context to determine if time should be +1440
 */
export function labelToValue(label: string, openMin: number, isOvernight: boolean): string {
  const [h, m] = label.substring(0, 5).split(":").map(Number);
  let min = h * 60 + m;
  // If overnight and time is in "after midnight" portion, add 1440
  if (isOvernight && min < openMin) {
    min += 1440;
  }
  return String(min);
}

/**
 * Convert value (raw minutes string) back to HH:MM for API calls
 */
export function valueToLabel(value: string): string {
  const min = parseInt(value, 10);
  if (isNaN(min)) return value;
  return minutesToLabel(min);
}

/**
 * Generate time options for shift selection.
 * OVERNIGHT FIX: Handle overnight opening hours (e.g., 10:00-02:00)
 * Returns objects with unique value (raw minutes) and display label (HH:MM)
 */
export function generateTimeOptions(openTime: string, closeTime: string): TimeOption[] {
  const options: TimeOption[] = [];
  
  const [openH, openM] = openTime.split(":").map(Number);
  const openMin = openH * 60 + openM;
  
  const [closeH, closeM] = closeTime.split(":").map(Number);
  let closeMin = closeH * 60 + closeM;
  
  // OVERNIGHT FIX: If close < open, treat close as next day (add 1440 minutes)
  if (closeMin < openMin) {
    closeMin += 1440; // e.g., 02:00 becomes 26:00 (1440 + 120)
  } else if (closeMin === 0 && openMin > 0) {
    closeMin = 1440; // Midnight special case
  }
  
  const step = ADMIN_TEST_MODE ? 1 : 15;
  for (let min = openMin; min <= closeMin; min += step) {
    options.push({ value: String(min), label: minutesToLabel(min) });
  }
  
  return options;
}

/**
 * Check if two time ranges overlap using raw minute values
 */
export function rangesOverlapByValue(aStartVal: string, aEndVal: string, bStartVal: string, bEndVal: string): boolean {
  const aS = parseInt(aStartVal, 10);
  const aE = parseInt(aEndVal, 10);
  const bS = parseInt(bStartVal, 10);
  const bE = parseInt(bEndVal, 10);
  if (isNaN(aS) || isNaN(aE) || isNaN(bS) || isNaN(bE)) return false;
  return aS < bE && bS < aE;
}

/**
 * Map backend error messages to user-friendly French text
 */
export function getDisplayErrorMessage(msg: string | null): string | null {
  if (!msg) return null;
  const lowerMsg = msg.toLowerCase();
  // Check for worked time overlap (badge_events)
  if (lowerMsg.includes("shift_overlaps_worked_time")) {
    return "Impossible : ce shift chevauche un temps déjà pointé (service ou extra).";
  }
  // Check for overlap validation failure (DB error = fail-close)
  if (lowerMsg.includes("worked_time_overlap_check_failed")) {
    return "Impossible de vérifier le chevauchement avec les pointages. Réessaie dans quelques secondes.";
  }
  // Check for planning shift overlap
  if (lowerMsg.includes("overlap") || lowerMsg.includes("chevauch")) {
    return "Ce shift chevauche un shift existant. Modifie les horaires pour éviter le chevauchement.";
  }
  return msg;
}

/**
 * Format date for French display
 */
export function formatShiftDate(shiftDate: string): string {
  if (!shiftDate) return "";
  return new Date(shiftDate + "T00:00:00").toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
