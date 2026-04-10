/**
 * Opening hours resolution for planning-week edge function
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { formatTime, timeToMinutes, normalizeEndMinutes } from "./time.ts";

type AnyClient = ReturnType<typeof createClient>;

export interface OpeningWindow {
  openMin: number;
  closeMin: number;
  isClosed: boolean;
}

/**
 * Resolve opening window for a given establishment and date
 * Priority: exceptions > weekly hours
 * Handles midnight (00:00) as end-of-day
 * 
 * @returns OpeningWindow with normalized times, or isClosed=true
 */
export async function resolveOpeningWindow(
  adminClient: AnyClient,
  establishmentId: string,
  shiftDate: string
): Promise<OpeningWindow> {
  // Get day of week - convert JS getDay() (0=Sunday) to ISO (1=Monday, 7=Sunday)
  const jsDay = new Date(shiftDate + "T00:00:00").getDay();
  const dayOfWeek = jsDay === 0 ? 7 : jsDay;

  // Check exception first
  const { data: exception } = await adminClient
    .from("establishment_opening_exceptions")
    .select("closed, open_time, close_time")
    .eq("establishment_id", establishmentId)
    .eq("date", shiftDate)
    .single();

  if (exception) {
    if (exception.closed) {
      return { openMin: 0, closeMin: 0, isClosed: true };
    }
    if (exception.open_time && exception.close_time) {
      const openMin = timeToMinutes(formatTime(exception.open_time));
      const closeMin = normalizeEndMinutes(openMin, exception.close_time);
      return { openMin, closeMin, isClosed: false };
    }
  }

  // Check weekly hours
  const { data: weeklyHours } = await adminClient
    .from("establishment_opening_hours")
    .select("closed, open_time, close_time")
    .eq("establishment_id", establishmentId)
    .eq("day_of_week", dayOfWeek)
    .single();

  if (weeklyHours) {
    if (weeklyHours.closed) {
      return { openMin: 0, closeMin: 0, isClosed: true };
    }
    if (weeklyHours.open_time && weeklyHours.close_time) {
      const openMin = timeToMinutes(formatTime(weeklyHours.open_time));
      const closeMin = normalizeEndMinutes(openMin, weeklyHours.close_time);
      return { openMin, closeMin, isClosed: false };
    }
  }

  // No hours configured - allow any time
  return { openMin: 0, closeMin: 24 * 60, isClosed: false };
}

/**
 * Validate shift times against opening window
 * OVERNIGHT FIX: Handle opening windows that cross midnight (e.g., 10:00-02:00)
 * @returns null if valid, error message if invalid
 */
export function validateShiftInOpeningWindow(
  shiftStartMin: number,
  shiftEndMin: number,
  window: OpeningWindow
): string | null {
  if (window.isClosed) {
    return "Establishment closed";
  }

  // Detect if opening window is overnight (close < open, e.g., 10:00-02:00)
  const isOvernight = window.closeMin > 1440 || window.closeMin < window.openMin;
  
  let normalizedCloseMin = window.closeMin;
  let normalizedShiftStart = shiftStartMin;
  let normalizedShiftEnd = shiftEndMin;
  
  if (isOvernight) {
    // Normalize close time to next day if not already
    if (normalizedCloseMin < window.openMin) {
      normalizedCloseMin += 1440;
    }
    
    // Normalize shift times: if they're in the "after midnight" portion
    if (normalizedShiftStart < window.openMin) {
      normalizedShiftStart += 1440;
    }
    if (normalizedShiftEnd < window.openMin && normalizedShiftEnd <= shiftStartMin) {
      normalizedShiftEnd += 1440;
    }
  }

  if (normalizedShiftStart < window.openMin || normalizedShiftEnd > normalizedCloseMin) {
    return "Outside opening hours";
  }

  return null;
}
