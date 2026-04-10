/**
 * Badge Events Monitoring
 * 
 * PHASE 3.3: Non-blocking WARN logs for edge cases
 * Purpose: Production visibility without UX impact
 */

/**
 * Log warning if early_departure_minutes is set on non-clock_out event
 * This should NEVER happen due to DB constraint, but we log just in case
 */
export function warnIfInvalidEarlyDeparture(
  eventType: string,
  earlyDepartureMinutes: number | null,
  badgeEventId: string
): void {
  if (earlyDepartureMinutes !== null && eventType !== "clock_out") {
    console.warn(
      `[BADGE-MONITOR] WARN: early_departure_minutes=${earlyDepartureMinutes} on event_type=${eventType} ` +
      `(badge_event_id=${badgeEventId}). This violates SSOT contract.`
    );
  }
}

/**
 * Log warning for future badge attempt (before blocking)
 * Helps track if UI guard is failing or users are manipulating requests
 */
export function warnFutureBadgeAttempt(
  action: string,
  occurredAt: string,
  userId: string,
  establishmentId: string
): void {
  const serverNow = new Date().toISOString();
  console.warn(
    `[BADGE-MONITOR] WARN: FUTURE_BADGE_BLOCKED - action=${action}, ` +
    `occurred_at=${occurredAt}, server_now=${serverNow}, ` +
    `user_id=${userId}, establishment_id=${establishmentId}`
  );
}

/**
 * Log info for successful badge creation with early departure
 * Useful for analytics on early departure patterns
 */
export function logEarlyDepartureCreated(
  userId: string,
  dayDate: string,
  earlyMinutes: number,
  sequenceIndex: number
): void {
  console.log(
    `[BADGE-MONITOR] INFO: Early departure recorded - user_id=${userId}, ` +
    `day_date=${dayDate}, early_minutes=${earlyMinutes}, sequence_index=${sequenceIndex}`
  );
}
