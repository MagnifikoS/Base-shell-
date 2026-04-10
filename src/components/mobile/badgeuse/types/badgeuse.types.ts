/**
 * Types du module Badgeuse V1
 */

export interface BadgeEvent {
  id: string;
  organization_id: string;
  establishment_id: string;
  user_id: string;
  event_type: "clock_in" | "clock_out";
  occurred_at: string;
  /** TIMESTAMPTZ - Effective time after tolerance rules applied */
  effective_at: string;
  day_date: string;
  sequence_index: number;
  device_id?: string;
  created_at: string;
}

export interface BadgeSettings {
  establishment_id: string;
  arrival_tolerance_min: number;
  departure_tolerance_min: number;
  extra_threshold_min: number;
  require_selfie: boolean;
  require_pin: boolean;
  device_binding_enabled: boolean;
  max_devices_per_user: number;
  early_arrival_limit_min: number; // Max minutes before shift start to accept badge
}

export interface BadgeStatus {
  isClockedIn: boolean;
  lastEvent: BadgeEvent | null;
  nextEventType: "clock_in" | "clock_out";
  currentSequence: number;
  canBadge: boolean;
  todayEvents: BadgeEvent[];
  /** V13: Detected forgotten clock_out from a previous shift */
  forgottenBadgeWarning: string | null;
  /** V13: Badge time doesn't match any planned shift within tolerance */
  hasMismatch: boolean;
}

export interface DayBadgeData {
  date: string;
  events: BadgeEvent[];
  shifts: Array<{
    sequence: number;
    clockIn?: BadgeEvent;
    clockOut?: BadgeEvent;
  }>;
}

export type BadgeStep = "idle" | "selfie" | "pin" | "confirming" | "success" | "error";
