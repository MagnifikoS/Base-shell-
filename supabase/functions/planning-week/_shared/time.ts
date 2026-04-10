/**
 * Time utilities for planning-week edge function
 * Pure functions, no side effects
 */

/**
 * Format time string to HH:mm
 */
export function formatTime(t: string): string {
  return t.substring(0, 5);
}

/**
 * Convert HH:mm to minutes since midnight
 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Normalize end time to handle overnight shifts correctly
 * If end < start, treat end as next day (add 1440 minutes)
 * Also handles 00:00 midnight case
 * 
 * @param startMin - Start time in minutes since midnight
 * @param endTimeStr - End time as "HH:mm" string
 * @returns End time in minutes, normalized for overnight if needed
 */
export function normalizeEndMinutes(startMin: number, endTimeStr: string): number {
  const normalized = formatTime(endTimeStr);
  const endMin = timeToMinutes(normalized);
  
  // OVERNIGHT FIX: If end < start, treat as next day
  if (endMin < startMin) {
    return endMin + 1440;
  }
  
  // Special case: 00:00 midnight with positive start
  if (endMin === 0 && startMin > 0) {
    return 1440; // 24:00
  }
  
  return endMin;
}

/**
 * Calculate duration in minutes between two times, handling midnight
 * 
 * @param startTimeStr - Start time as "HH:mm"
 * @param endTimeStr - End time as "HH:mm"
 * @returns Duration in minutes, always >= 0
 */
export function calculateDurationMinutes(startTimeStr: string, endTimeStr: string): number {
  const startMin = timeToMinutes(formatTime(startTimeStr));
  const endMin = normalizeEndMinutes(startMin, endTimeStr);
  return Math.max(0, endMin - startMin);
}
