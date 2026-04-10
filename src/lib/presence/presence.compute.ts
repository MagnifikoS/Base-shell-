/**
 * Pure functions for Presence module computations
 * No dependencies on React or external state
 * V3.5: Uses Paris timezone source (timeToMinutes centralized)
 */

import {
  formatParisHHMM,
  getTodayParis,
  timeToMinutes,
  minutesToXhYY,
  normalizeToServiceDayTimeline,
} from "@/lib/time/paris";

export interface PlannedShift {
  user_id: string;
  start_time: string;
  end_time: string;
  sequence_index?: number;
  profiles?: {
    full_name: string | null;
  };
}

export interface BadgeEvent {
  id: string;
  user_id: string;
  event_type: string;
  occurred_at: string;
  effective_at: string;
  day_date: string;
  sequence_index: number;
  late_minutes?: number | null; // V3.2: Source of truth from DB
  early_departure_minutes?: number | null; // V3.3: SSOT for early departure
  created_at?: string; // V13: Needed for planning modification detection
}

/**
 * Single session within a PresenceEmployeeCard
 * Represents one shift + its badge events
 * V4.1: Uses UI flags (isNotStartedYet, isFinishedWithoutClockIn) instead of status enum
 */
export interface PresenceSession {
  sequenceIndex: number;
  plannedStart: string;
  plannedEnd: string;
  clockIn: string | null; // HH:mm or null
  clockOut: string | null; // HH:mm or null
  lateMinutes: number;
  earlyDepartureMinutes: number; // V3.3: SSOT from clock_out event
  status: "present" | "absent" | "unknown"; // unknown = orphan clock_out ONLY
  /** UI flag: shift not yet finished and no clock_in */
  isNotStartedYet: boolean;
  /** UI flag: shift finished with no clock_in = true absence */
  isFinishedWithoutClockIn: boolean;
  /** UI flag: has clock_in, no clock_out, shift is finished = forgotten clock_out */
  isFinishedWithoutClockOut: boolean;
  clockInEvent: BadgeEvent | null;
  clockOutEvent: BadgeEvent | null;
  /** @deprecated V15: Removed — retard/départ anticipé already handled by SSOT fields */
  hasMismatch?: boolean;
  /** V13: Planning was modified after badge events were created */
  planningModifiedAfterBadge: boolean;
}

/**
 * One card per employee per day
 * Contains all sessions (shifts) for that employee
 */
export interface PresenceEmployeeCard {
  userId: string;
  fullName: string;
  sessions: PresenceSession[];
  allEvents: BadgeEvent[];
  /** Total late minutes = SUM of all session.lateMinutes (not max) */
  totalLateMinutes: number;
  /** @deprecated Use totalLateMinutes - kept for backwards compat */
  cumulativeLateMinutes: number;
  /** Source of this employee: 'planning' (has shifts) or 'badge_only' (no shift, only badge events) */
  source?: "planning" | "badge_only";
  /** Optional team ID (unified for Presence + History) */
  teamId?: string | null;
  /** Optional team name (unified for Presence + History) */
  teamName?: string | null;
  /** @deprecated V15: Removed — retard/départ anticipé already handled by SSOT fields */
  hasAnyMismatch?: boolean;
  /** V13: Planning was modified after some badge events were created */
  hasPlanningModification?: boolean;
}

// Legacy type kept for backwards compatibility with BadgeEditModal
// V4.1: Uses UI flags instead of status enum for pending states
export interface PresenceEmployee {
  userId: string;
  fullName: string;
  plannedStart: string;
  plannedEnd: string;
  sequenceIndex: number;
  status: "present" | "absent" | "unknown"; // unknown = orphan clock_out ONLY
  /** UI flag: shift not yet finished and no clock_in */
  isNotStartedYet: boolean;
  /** UI flag: shift finished with no clock_in = true absence */
  isFinishedWithoutClockIn: boolean;
  /** UI flag: has clock_in, no clock_out, shift is finished = forgotten clock_out */
  isFinishedWithoutClockOut: boolean;
  lateMinutes: number;
  cumulativeLateMinutes?: number; // V2: total late_minutes ONLY (NOT absence)
  clockInEvent: BadgeEvent | null;
  clockOutEvent: BadgeEvent | null;
  allEvents: BadgeEvent[];
}

/**
 * Extract HH:mm from ISO timestamp in Paris timezone
 * V3.3: Delegates to central paris.ts helper
 */
export function isoToHHMM(isoString: string): string {
  return formatParisHHMM(isoString);
}

/**
 * Get today's date in YYYY-MM-DD format (Paris timezone)
 * V3.3: Delegates to central paris.ts helper
 */
export function getTodayLocal(): string {
  return getTodayParis();
}

/**
 * Compute late minutes based on occurred_at vs planned_start
 * Returns 0 if on time or early
 */
export function computeLateMinutes(occurredAt: string, plannedStart: string): number {
  const occurredTime = isoToHHMM(occurredAt);
  const occurredMin = timeToMinutes(occurredTime);
  const plannedMin = timeToMinutes(plannedStart.slice(0, 5));

  const late = occurredMin - plannedMin;
  return Math.max(0, late);
}

/**
 * Compute shift duration in minutes
 */
function _computeShiftDuration(startTime: string, endTime: string): number {
  const startMin = timeToMinutes(startTime.slice(0, 5));
  const endMin = timeToMinutes(endTime.slice(0, 5));
  // Handle overnight shifts
  if (endMin < startMin) {
    return 1440 - startMin + endMin;
  }
  return endMin - startMin;
}

/**
 * Merge planning shifts and badge events into presence data.
 * V2: Supports multiple shifts per user (max 2), cumulative lateness, orphan detection.
 * V4: Added nowParisHHMM param - absent only if shift is finished (nowParis > end_time)
 * V5: Added cutoffHHMM param - uses service_day_cutoff for overnight shift handling (SSOT)
 * Returns legacy PresenceEmployee[] for backwards compatibility.
 * @param shifts - Array of planned shifts
 * @param events - Array of badge events
 * @param nowParisHHMM - Current time in Paris (HH:mm), used to determine if shift is finished
 * @param cutoffHHMM - Establishment's service day cutoff (HH:mm), default "03:00"
 */
export function computePresenceData(
  shifts: PlannedShift[],
  events: BadgeEvent[],
  nowParisHHMM?: string,
  cutoffHHMM: string = "03:00"
): PresenceEmployee[] {
  // Group events by user_id
  const eventsByUser = new Map<string, BadgeEvent[]>();
  for (const event of events) {
    const existing = eventsByUser.get(event.user_id) || [];
    existing.push(event);
    eventsByUser.set(event.user_id, existing);
  }

  // Group shifts by user_id -> array of shifts (sorted by sequence)
  const shiftsByUser = new Map<string, PlannedShift[]>();
  for (const shift of shifts) {
    const existing = shiftsByUser.get(shift.user_id) || [];
    existing.push(shift);
    shiftsByUser.set(shift.user_id, existing);
  }

  // Sort each user's shifts by sequence_index
  for (const [_userId, userShifts] of shiftsByUser) {
    userShifts.sort((a, b) => (a.sequence_index || 1) - (b.sequence_index || 1));
  }

  const result: PresenceEmployee[] = [];

  for (const [userId, userShifts] of shiftsByUser) {
    const userEvents = eventsByUser.get(userId) || [];
    let cumulativeLateMinutes = 0;

    // Process each shift for this user
    for (const shift of userShifts) {
      const seqIndex = shift.sequence_index || 1;

      // Find clock_in and clock_out for this specific sequence
      const clockInEvent =
        userEvents.find((e) => e.event_type === "clock_in" && e.sequence_index === seqIndex) ||
        null;

      const clockOutEvent =
        userEvents.find((e) => e.event_type === "clock_out" && e.sequence_index === seqIndex) ||
        null;

      // Determine status and UI flags
      // V4.1: Status is only present/absent/unknown, UI flags handle "not started yet"
      let status: "present" | "absent" | "unknown" = "absent";
      let shiftLateMinutes = 0;

      // ═══════════════════════════════════════════════════════════════════════
      // V5: SSOT - Use service_day_cutoff for overnight handling
      // Normalize all times to service day timeline for consistent comparison
      // ═══════════════════════════════════════════════════════════════════════
      const plannedStartHHMM = shift.start_time.slice(0, 5);
      const plannedEndHHMM = shift.end_time.slice(0, 5);

      // Normalize to service day timeline (adds +1440 if < cutoff)
      const plannedStartMin = normalizeToServiceDayTimeline(plannedStartHHMM, cutoffHHMM);
      let plannedEndMin = normalizeToServiceDayTimeline(plannedEndHHMM, cutoffHHMM);

      // Handle overnight shifts: if normalized end <= normalized start, add 1440
      // This handles edge cases where start is pre-cutoff and end is post-cutoff
      if (plannedEndMin <= plannedStartMin) {
        plannedEndMin += 1440;
      }

      // Normalize current time to same timeline
      const nowHHMM = nowParisHHMM || "23:59";
      const nowMin = normalizeToServiceDayTimeline(nowHHMM, cutoffHHMM);

      const hasShiftStarted = nowMin >= plannedStartMin;
      const isShiftFinished = nowMin > plannedEndMin;

      // UI flags - derived, not stored
      // À venir: shift not started yet (now < start)
      // Absent temporaire: shift started but not finished, no badge
      // Absent: shift finished with no badge
      // Oubli départ: has clock_in, no clock_out, shift finished
      const isNotStartedYet = !clockInEvent && !clockOutEvent && !hasShiftStarted;
      const isFinishedWithoutClockIn = !clockInEvent && !clockOutEvent && isShiftFinished;
      const isFinishedWithoutClockOut = !!clockInEvent && !clockOutEvent && isShiftFinished;

      // Check for orphan clock_out (no clock_in but has clock_out)
      if (!clockInEvent && clockOutEvent) {
        status = "unknown"; // Orphan case - ONLY use of "unknown"
      } else if (clockInEvent) {
        status = "present";
        // V3.2: Use late_minutes from DB (source of truth), fallback to 0 for old data
        shiftLateMinutes = clockInEvent.late_minutes ?? 0;
      } else if (isFinishedWithoutClockIn) {
        // V4.1: Only mark absent if shift is FINISHED and no clock_in
        status = "absent";
        // DO NOT add to cumulativeLateMinutes - absence ≠ retard
      } else {
        // Shift not finished yet, no clock_in = still "absent" for status
        // But isNotStartedYet flag tells UI to display differently
        status = "absent";
      }

      // cumulativeLateMinutes = SUM of late_minutes ONLY (never absence)
      const totalLate = cumulativeLateMinutes + shiftLateMinutes;

      result.push({
        userId,
        fullName: shift.profiles?.full_name || "Inconnu",
        plannedStart: shift.start_time.slice(0, 5),
        plannedEnd: shift.end_time.slice(0, 5),
        sequenceIndex: seqIndex,
        status,
        isNotStartedYet,
        isFinishedWithoutClockIn,
        isFinishedWithoutClockOut,
        lateMinutes: shiftLateMinutes,
        cumulativeLateMinutes: totalLate,
        clockInEvent,
        clockOutEvent,
        allEvents: userEvents,
      });

      // If present with late, add to cumulative for next shift
      if (status === "present" && shiftLateMinutes > 0) {
        cumulativeLateMinutes += shiftLateMinutes;
      }
    }
  }

  // Sort by name, then by sequence index
  result.sort((a, b) => {
    const nameCompare = a.fullName.localeCompare(b.fullName);
    if (nameCompare !== 0) return nameCompare;
    return a.sequenceIndex - b.sequenceIndex;
  });

  return result;
}

/**
 * Group PresenceEmployee[] by userId into PresenceEmployeeCard[]
 * This is the NEW structure: 1 card per employee with sessions[] inside
 */
export function groupByEmployee(employees: PresenceEmployee[], cutoffHHMM: string = "03:00"): PresenceEmployeeCard[] {
  const cardMap = new Map<string, PresenceEmployeeCard>();

  for (const emp of employees) {
    let card = cardMap.get(emp.userId);

    if (!card) {
      card = {
        userId: emp.userId,
        fullName: emp.fullName,
        sessions: [],
        allEvents: emp.allEvents,
        totalLateMinutes: 0,
        cumulativeLateMinutes: 0, // kept for backwards compat
      };
      cardMap.set(emp.userId, card);
    }

    // V15: Mismatch logic removed — retard & départ anticipé are SSOT from badge_events DB fields

    // Add session
    card.sessions.push({
      sequenceIndex: emp.sequenceIndex,
      plannedStart: emp.plannedStart,
      plannedEnd: emp.plannedEnd,
      clockIn: emp.clockInEvent ? isoToHHMM(emp.clockInEvent.occurred_at) : null,
      clockOut: emp.clockOutEvent ? isoToHHMM(emp.clockOutEvent.occurred_at) : null,
      lateMinutes: emp.lateMinutes,
      earlyDepartureMinutes: emp.clockOutEvent?.early_departure_minutes ?? 0,
      status: emp.status,
      isNotStartedYet: emp.isNotStartedYet,
      isFinishedWithoutClockIn: emp.isFinishedWithoutClockIn,
      isFinishedWithoutClockOut: emp.isFinishedWithoutClockOut,
      clockInEvent: emp.clockInEvent,
      clockOutEvent: emp.clockOutEvent,
      hasMismatch: false,
      planningModifiedAfterBadge: false, // Set later by caller with shift data
    });

    // SUM late minutes (not max) - this is the correct behavior
    card.totalLateMinutes += emp.lateMinutes;
    card.cumulativeLateMinutes = card.totalLateMinutes; // sync for backwards compat
  }

  // Convert to array and sort by name
  const result = Array.from(cardMap.values());
  result.sort((a, b) => a.fullName.localeCompare(b.fullName));

  // Sort sessions within each card by sequenceIndex
  for (const card of result) {
    card.sessions.sort((a, b) => a.sequenceIndex - b.sequenceIndex);
    // V15: hasAnyMismatch always false (mismatch logic removed)
    card.hasAnyMismatch = false;
    card.hasPlanningModification = card.sessions.some((s) => s.planningModifiedAfterBadge);
  }

  return result;
}

/**
 * Merge badge-only users into the presence list.
 * These are employees who have badge_events but NO planned shifts for the day.
 * They should appear as "Présent (hors planning)" in the UI.
 *
 * @param existingCards - Cards from planning-based computation
 * @param allEvents - All badge events for the day (all users in establishment)
 * @param profilesMap - Map of user_id -> full_name
 * @returns Merged list with badge_only users added
 */
export function mergeBadgeOnlyUsers(
  existingCards: PresenceEmployeeCard[],
  allEvents: BadgeEvent[],
  profilesMap: Map<string, string>
): PresenceEmployeeCard[] {
  // Mark existing cards as source=planning
  for (const card of existingCards) {
    card.source = "planning";
  }

  // Get set of user IDs already in the list (from planning)
  const plannedUserIds = new Set(existingCards.map((c) => c.userId));

  // Group all events by user_id
  const eventsByUser = new Map<string, BadgeEvent[]>();
  for (const event of allEvents) {
    const existing = eventsByUser.get(event.user_id) || [];
    existing.push(event);
    eventsByUser.set(event.user_id, existing);
  }

  // Find users with badge events but NOT in planning
  const badgeOnlyCards: PresenceEmployeeCard[] = [];

  for (const [userId, userEvents] of eventsByUser) {
    // Skip if user already has a planned shift
    if (plannedUserIds.has(userId)) continue;

    // Only include if there's at least one clock_in or clock_out
    const hasValidEvent = userEvents.some(
      (e) => e.event_type === "clock_in" || e.event_type === "clock_out"
    );
    if (!hasValidEvent) continue;

    // Find earliest clock_in and latest clock_out
    const clockInEvents = userEvents
      .filter((e) => e.event_type === "clock_in")
      .sort((a, b) => a.effective_at.localeCompare(b.effective_at));
    const clockOutEvents = userEvents
      .filter((e) => e.event_type === "clock_out")
      .sort((a, b) => b.effective_at.localeCompare(a.effective_at));

    const firstClockIn = clockInEvents[0] || null;
    const lastClockOut = clockOutEvents[0] || null;

    // Build a synthetic session for display
    const session: PresenceSession = {
      sequenceIndex: 1,
      plannedStart: "--:--", // No planned shift
      plannedEnd: "--:--",
      clockIn: firstClockIn ? isoToHHMM(firstClockIn.occurred_at) : null,
      clockOut: lastClockOut ? isoToHHMM(lastClockOut.occurred_at) : null,
      lateMinutes: 0, // Cannot be late without a plan
      earlyDepartureMinutes: 0, // Cannot be early without a plan
      status: firstClockIn ? "present" : "unknown", // Present if has clock_in
      isNotStartedYet: false,
      isFinishedWithoutClockIn: false,
      isFinishedWithoutClockOut: false, // No planned shift = cannot determine
      clockInEvent: firstClockIn,
      clockOutEvent: lastClockOut,
      hasMismatch: false, // No planned shift = no mismatch possible
      planningModifiedAfterBadge: false,
    };

    badgeOnlyCards.push({
      userId,
      fullName: profilesMap.get(userId) || "Inconnu",
      sessions: [session],
      allEvents: userEvents,
      totalLateMinutes: 0,
      cumulativeLateMinutes: 0,
      source: "badge_only",
    });
  }

  // Sort badge-only cards by name
  badgeOnlyCards.sort((a, b) => a.fullName.localeCompare(b.fullName));

  // Return merged list: planning users first, then badge-only users
  return [...existingCards, ...badgeOnlyCards];
}

/**
 * V13: Detect if planning was modified after badge events were created.
 * Sets planningModifiedAfterBadge on sessions where shift.updated_at > earliest badge created_at.
 *
 * @param cards - Presence cards to mutate in-place
 * @param shiftUpdatedAtMap - Map of `userId:sequenceIndex` -> shift updated_at ISO string
 */
export function applyPlanningModificationFlags(
  cards: PresenceEmployeeCard[],
  shiftUpdatedAtMap: Map<string, string>
): void {
  for (const card of cards) {
    for (const session of card.sessions) {
      const key = `${card.userId}:${session.sequenceIndex}`;
      const shiftUpdatedAt = shiftUpdatedAtMap.get(key);

      if (!shiftUpdatedAt) continue;

      // Find the earliest badge event created_at for this session
      const sessionEvents = [session.clockInEvent, session.clockOutEvent].filter(
        (ev): ev is BadgeEvent => ev !== null
      );
      if (sessionEvents.length === 0) continue;

      const earliestBadgeCreatedAt = sessionEvents
        .map((ev) => ev.created_at || ev.occurred_at)
        .sort()[0];

      if (!earliestBadgeCreatedAt) continue;

      // Compare: if shift was updated AFTER badge events were created
      if (new Date(shiftUpdatedAt).getTime() > new Date(earliestBadgeCreatedAt).getTime()) {
        session.planningModifiedAfterBadge = true;
      }
    }

    // Update card-level flag
    card.hasPlanningModification = card.sessions.some((s) => s.planningModifiedAfterBadge);
  }
}

/**
 * Format late/extra minutes for display
 * Delegates to central minutesToXhYY for consistency
 */
export function formatLateMinutes(minutes: number): string {
  if (minutes <= 0) return "";
  return minutesToXhYY(minutes);
}
