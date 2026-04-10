/**
 * R-Extra Module Types
 * PHASE 1: Independent module for R.Extra (compensatory time off)
 */

export interface RextraEvent {
  userId: string;
  date: string; // YYYY-MM-DD
  minutes: number;
}

export interface RextraBalance {
  userId: string;
  minutes: number;
}

export interface RextraByEmployeeByDate {
  [userId: string]: {
    [date: string]: number;
  };
}

export interface SetRextraParams {
  establishmentId: string;
  userId: string;
  eventDate: string;
  minutes: number;
  weekStart: string; // For cache invalidation
}

export interface ClearRextraParams {
  establishmentId: string;
  userId: string;
  eventDate: string;
  weekStart: string; // For cache invalidation
}

export interface SetRextraResponse {
  success: boolean;
  minutes: number;
  previous_minutes: number;
  delta_minutes: number;
  new_balance: number;
  deleted_shifts_count: number;
}

export interface ClearRextraResponse {
  success: boolean;
  credited_minutes: number;
  new_balance: number;
}
