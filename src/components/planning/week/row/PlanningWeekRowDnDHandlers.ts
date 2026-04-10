import type { PlanningShift, PlanningOpeningWindow } from "../../types/planning.types";
import type { PersonnelLeave } from "@/hooks/personnel/usePersonnelLeaves";

export interface DragPayload {
  start_time: string;
  end_time: string;
  fromShiftId: string;
  fromEmployeeId: string;
  isLeave?: boolean;
  leaveType?: "absence" | "repos" | "cp" | "am";
  sourceDate?: string;
}

export interface PendingDropIntent {
  targetDate: string;
  payload: DragPayload;
  leave: PersonnelLeave;
}

/**
 * Parse drag payload from dataTransfer
 * Returns null if invalid
 */
export function parseDragPayload(e: React.DragEvent): DragPayload | null {
  try {
    const rawData = e.dataTransfer.getData("application/json");
    if (!rawData) return null;
    const payload = JSON.parse(rawData) as DragPayload;

    // Leave payload: requires isLeave, leaveType, sourceDate, fromEmployeeId
    if (payload.isLeave) {
      if (!payload.leaveType || !payload.sourceDate || !payload.fromEmployeeId) {
        return null;
      }
      return payload;
    }

    // Shift payload: requires start_time, end_time, fromShiftId, fromEmployeeId
    if (
      !payload.start_time ||
      !payload.end_time ||
      !payload.fromShiftId ||
      !payload.fromEmployeeId
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Check if a drop can proceed directly (no blocking conditions)
 * Returns error message if blocked, null if can proceed
 */
export function getDropBlockingError(
  targetDate: string,
  openingByDate: Record<string, PlanningOpeningWindow>,
  shiftsByDate: Record<string, PlanningShift[]>
): string | null {
  const targetOpening = openingByDate[targetDate];

  // Check if target day is closed
  if (targetOpening?.isClosed) {
    return "L'établissement est fermé ce jour.";
  }

  // Check if target day already has 2 shifts
  const targetShifts = shiftsByDate[targetDate] || [];
  if (targetShifts.length >= 2) {
    return "Maximum 2 shifts par jour atteint.";
  }

  return null;
}
