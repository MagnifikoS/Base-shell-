/**
 * Presence Computation Engine — Integration Tests
 *
 * These tests verify complex presence scenarios that go beyond unit testing.
 * They simulate realistic restaurant scenarios:
 * - Normal day with arrival + departure
 * - Day spanning midnight (overnight shifts)
 * - Multiple badge events (split shifts / break handling)
 * - Missing departure (employee still at work)
 * - Service day cutoff handling
 * - Badge-only users (no planning)
 * - Full groupByEmployee pipeline
 *
 * All times use Europe/Paris timezone (CET = UTC+1 winter, CEST = UTC+2 summer).
 * ISO timestamps are in UTC for determinism.
 */

import { describe, it, expect } from "vitest";
import {
  isoToHHMM,
  computeLateMinutes,
  computePresenceData,
  groupByEmployee,
  mergeBadgeOnlyUsers,
  formatLateMinutes,
  type PlannedShift,
  type BadgeEvent,
} from "../presence.compute";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let eventCounter = 0;

function makeShift(overrides: {
  user_id: string;
  start_time: string;
  end_time: string;
  sequence_index?: number;
  profiles?: { full_name: string | null };
}): PlannedShift {
  return {
    sequence_index: 1,
    profiles: { full_name: "Employe Test" },
    ...overrides,
  };
}

function makeEvent(overrides: {
  user_id: string;
  event_type: string;
  sequence_index?: number;
  occurred_at?: string;
  effective_at?: string;
  day_date?: string;
  late_minutes?: number | null;
  early_departure_minutes?: number | null;
}): BadgeEvent {
  eventCounter++;
  return {
    id: `evt-${eventCounter}`,
    occurred_at: "2026-01-15T08:00:00Z",
    effective_at: "2026-01-15T08:00:00Z",
    day_date: "2026-01-15",
    sequence_index: 1,
    late_minutes: null,
    early_departure_minutes: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: Normal day with arrival + departure
// ─────────────────────────────────────────────────────────────────────────────

describe("Normal day: arrival + departure", () => {
  it("full day with on-time clock_in and clock_out produces correct card", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "chef-1",
        start_time: "09:00",
        end_time: "17:00",
        profiles: { full_name: "Pierre Chef" },
      }),
    ];

    // 09:00 Paris = 08:00 UTC (winter CET)
    // 17:00 Paris = 16:00 UTC
    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "chef-1",
        event_type: "clock_in",
        sequence_index: 1,
        occurred_at: "2026-01-15T08:00:00Z",
        effective_at: "2026-01-15T08:00:00Z",
        late_minutes: 0,
      }),
      makeEvent({
        user_id: "chef-1",
        event_type: "clock_out",
        sequence_index: 1,
        occurred_at: "2026-01-15T16:00:00Z",
        effective_at: "2026-01-15T16:00:00Z",
        early_departure_minutes: 0,
      }),
    ];

    const employees = computePresenceData(shifts, events, "18:00");
    expect(employees).toHaveLength(1);

    const emp = employees[0];
    expect(emp.userId).toBe("chef-1");
    expect(emp.fullName).toBe("Pierre Chef");
    expect(emp.status).toBe("present");
    expect(emp.lateMinutes).toBe(0);
    expect(emp.clockInEvent).not.toBeNull();
    expect(emp.clockOutEvent).not.toBeNull();
    expect(emp.isFinishedWithoutClockOut).toBe(false);
    expect(emp.isFinishedWithoutClockIn).toBe(false);
    expect(emp.isNotStartedYet).toBe(false);

    // Verify grouping
    const cards = groupByEmployee(employees);
    expect(cards).toHaveLength(1);
    expect(cards[0].sessions).toHaveLength(1);
    expect(cards[0].sessions[0].clockIn).toBe("09:00");
    expect(cards[0].sessions[0].clockOut).toBe("17:00");
    expect(cards[0].sessions[0].earlyDepartureMinutes).toBe(0);
    expect(cards[0].totalLateMinutes).toBe(0);
  });

  it("day with 15-minute late arrival records correct late minutes", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "09:00",
        end_time: "17:00",
        profiles: { full_name: "Marie Serveur" },
      }),
    ];

    // 09:15 Paris = 08:15 UTC
    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        sequence_index: 1,
        occurred_at: "2026-01-15T08:15:00Z",
        effective_at: "2026-01-15T08:15:00Z",
        late_minutes: 15,
      }),
    ];

    const employees = computePresenceData(shifts, events, "12:00");
    expect(employees[0].lateMinutes).toBe(15);
    expect(employees[0].status).toBe("present");

    const cards = groupByEmployee(employees);
    expect(cards[0].totalLateMinutes).toBe(15);
  });

  it("day with early departure records early departure minutes in card", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
    ];

    // Clocked out at 16:30 Paris = 15:30 UTC
    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        sequence_index: 1,
        late_minutes: 0,
      }),
      makeEvent({
        user_id: "u1",
        event_type: "clock_out",
        sequence_index: 1,
        occurred_at: "2026-01-15T15:30:00Z",
        effective_at: "2026-01-15T15:30:00Z",
        early_departure_minutes: 30,
      }),
    ];

    const employees = computePresenceData(shifts, events, "18:00");
    const cards = groupByEmployee(employees);

    expect(cards[0].sessions[0].earlyDepartureMinutes).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: Overnight shifts (crossing midnight)
// ─────────────────────────────────────────────────────────────────────────────

describe("Overnight shifts (crossing midnight)", () => {
  it("night shift 22:00-02:00: employee present during shift", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "22:00",
        end_time: "02:00",
        profiles: { full_name: "Night Worker" },
      }),
    ];

    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        sequence_index: 1,
        late_minutes: 0,
      }),
    ];

    // At 23:30, shift is in progress (with cutoff 03:00)
    const employees = computePresenceData(shifts, events, "23:30", "03:00");
    expect(employees[0].status).toBe("present");
    expect(employees[0].isFinishedWithoutClockOut).toBe(false);
  });

  it("night shift 22:00-02:00: absent after shift ends (02:30 with 03:00 cutoff)", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "22:00",
        end_time: "02:00",
      }),
    ];

    // No events, at 02:30 the shift has ended
    const employees = computePresenceData(shifts, [], "02:30", "03:00");
    expect(employees[0].status).toBe("absent");
    expect(employees[0].isFinishedWithoutClockIn).toBe(true);
  });

  it("night shift 20:00-01:00: not started at 18:00", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "20:00",
        end_time: "01:00",
      }),
    ];

    const employees = computePresenceData(shifts, [], "18:00", "03:00");
    expect(employees[0].isNotStartedYet).toBe(true);
    expect(employees[0].isFinishedWithoutClockIn).toBe(false);
  });

  it("night shift with clock_in but no clock_out, shift finished: forgotten clock_out", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "22:00",
        end_time: "02:00",
      }),
    ];

    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        sequence_index: 1,
        late_minutes: 0,
      }),
    ];

    // At 02:30, shift is over but no clock_out
    const employees = computePresenceData(shifts, events, "02:30", "03:00");
    expect(employees[0].status).toBe("present");
    expect(employees[0].isFinishedWithoutClockOut).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: Split shifts (multiple shifts per employee)
// ─────────────────────────────────────────────────────────────────────────────

describe("Split shifts (multiple shifts per employee)", () => {
  it("full day with two shifts: morning and evening", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "09:00",
        end_time: "14:00",
        sequence_index: 1,
        profiles: { full_name: "Split Worker" },
      }),
      makeShift({
        user_id: "u1",
        start_time: "18:00",
        end_time: "23:00",
        sequence_index: 2,
        profiles: { full_name: "Split Worker" },
      }),
    ];

    const events: BadgeEvent[] = [
      // Morning shift: on time
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        sequence_index: 1,
        late_minutes: 0,
      }),
      makeEvent({
        user_id: "u1",
        event_type: "clock_out",
        sequence_index: 1,
        early_departure_minutes: 0,
      }),
      // Evening shift: 10 min late
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        sequence_index: 2,
        late_minutes: 10,
      }),
      makeEvent({
        user_id: "u1",
        event_type: "clock_out",
        sequence_index: 2,
        early_departure_minutes: 15,
      }),
    ];

    const employees = computePresenceData(shifts, events, "23:30");
    expect(employees).toHaveLength(2);

    // Group into cards
    const cards = groupByEmployee(employees);
    expect(cards).toHaveLength(1);
    expect(cards[0].sessions).toHaveLength(2);
    expect(cards[0].fullName).toBe("Split Worker");

    // Session 1: on time
    const session1 = cards[0].sessions.find((s) => s.sequenceIndex === 1)!;
    expect(session1.lateMinutes).toBe(0);
    expect(session1.earlyDepartureMinutes).toBe(0);

    // Session 2: late + early departure
    const session2 = cards[0].sessions.find((s) => s.sequenceIndex === 2)!;
    expect(session2.lateMinutes).toBe(10);
    expect(session2.earlyDepartureMinutes).toBe(15);

    // Total late = 0 + 10 = 10
    expect(cards[0].totalLateMinutes).toBe(10);
  });

  it("first shift absent, second shift present", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "09:00",
        end_time: "14:00",
        sequence_index: 1,
      }),
      makeShift({
        user_id: "u1",
        start_time: "18:00",
        end_time: "23:00",
        sequence_index: 2,
      }),
    ];

    // Only clock_in for second shift
    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        sequence_index: 2,
        late_minutes: 5,
      }),
    ];

    const employees = computePresenceData(shifts, events, "23:30");
    const cards = groupByEmployee(employees);

    expect(cards[0].sessions).toHaveLength(2);

    // First shift: absent (finished without clock_in)
    const session1 = cards[0].sessions.find((s) => s.sequenceIndex === 1)!;
    expect(session1.status).toBe("absent");

    // Second shift: present
    const session2 = cards[0].sessions.find((s) => s.sequenceIndex === 2)!;
    expect(session2.status).toBe("present");
    expect(session2.lateMinutes).toBe(5);

    // Total late: only from present shifts (not absences)
    expect(cards[0].totalLateMinutes).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: Missing departure (still at work)
// ─────────────────────────────────────────────────────────────────────────────

describe("Missing departure (employee still at work)", () => {
  it("employee clocked in, shift still in progress: present, not forgotten", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "09:00",
        end_time: "17:00",
      }),
    ];

    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        sequence_index: 1,
        late_minutes: 0,
      }),
    ];

    // Now is 14:00 (shift ends at 17:00), still in progress
    const employees = computePresenceData(shifts, events, "14:00");
    expect(employees[0].status).toBe("present");
    expect(employees[0].isFinishedWithoutClockOut).toBe(false);
    expect(employees[0].clockOutEvent).toBeNull();
  });

  it("employee clocked in, shift ended without clock_out: forgotten departure", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "09:00",
        end_time: "17:00",
      }),
    ];

    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        sequence_index: 1,
        late_minutes: 0,
      }),
    ];

    // Now is 18:00 (shift ended at 17:00)
    const employees = computePresenceData(shifts, events, "18:00");
    expect(employees[0].status).toBe("present");
    expect(employees[0].isFinishedWithoutClockOut).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: Service day cutoff handling
// ─────────────────────────────────────────────────────────────────────────────

describe("Service day cutoff handling", () => {
  it("cutoff at 03:00: shift ending at 02:00 is detected as finished at 02:30", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "22:00",
        end_time: "02:00",
      }),
    ];

    // At 02:30 with cutoff 03:00, both 02:30 and 02:00 are post-midnight (same service day)
    const employees = computePresenceData(shifts, [], "02:30", "03:00");
    expect(employees[0].status).toBe("absent");
    expect(employees[0].isFinishedWithoutClockIn).toBe(true);
  });

  it("cutoff at 05:00: shift 22:00-04:00 not finished at 03:30", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "22:00",
        end_time: "04:00",
      }),
    ];

    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        sequence_index: 1,
        late_minutes: 0,
      }),
    ];

    // Cutoff at 05:00, now at 03:30, shift ends at 04:00
    // 03:30 < 05:00 so normalized: 03:30+1440 = 1650
    // 04:00 < 05:00 so normalized: 04:00+1440 = 1680
    // 1650 < 1680 so shift not finished
    const employees = computePresenceData(shifts, events, "03:30", "05:00");
    expect(employees[0].status).toBe("present");
    expect(employees[0].isFinishedWithoutClockOut).toBe(false);
  });

  it("cutoff at 05:00: shift 22:00-04:00 finished at 04:30", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "22:00",
        end_time: "04:00",
      }),
    ];

    // No events, at 04:30 with cutoff 05:00
    // 04:30 < 05:00 so normalized: 04:30+1440 = 1710
    // 04:00 < 05:00 so normalized: 04:00+1440 = 1680
    // 1710 > 1680 so shift is finished
    const employees = computePresenceData(shifts, [], "04:30", "05:00");
    expect(employees[0].isFinishedWithoutClockIn).toBe(true);
  });

  it("default cutoff 03:00 is used when not specified", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "22:00",
        end_time: "01:00",
      }),
    ];

    // With default cutoff 03:00:
    // 01:30 < 03:00 so normalized: 01:30+1440 = 1530
    // 01:00 < 03:00 so normalized: 01:00+1440 = 1500
    // 1530 > 1500 so shift is finished at 01:30
    const employees = computePresenceData(shifts, [], "01:30");
    expect(employees[0].isFinishedWithoutClockIn).toBe(true);

    // But at 23:59 the shift is NOT finished yet (overnight, end=01:00 is post-midnight)
    // 23:59 normalized = 1439, end 01:00 normalized = 1500
    // 1439 < 1500 so shift not finished
    const employees2 = computePresenceData(shifts, [], "23:59");
    expect(employees2[0].isFinishedWithoutClockIn).toBe(false);
    expect(employees2[0].isNotStartedYet).toBe(false); // shift started (23:59 > 22:00)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: Badge-only users (no planning)
// ─────────────────────────────────────────────────────────────────────────────

describe("Badge-only users merged with planning users", () => {
  it("complete scenario: planning + badge-only users merged correctly", () => {
    // Planning-based employees
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "planned-1",
        start_time: "09:00",
        end_time: "17:00",
        profiles: { full_name: "Alice Planned" },
      }),
    ];

    const planningEvents: BadgeEvent[] = [
      makeEvent({
        user_id: "planned-1",
        event_type: "clock_in",
        sequence_index: 1,
        late_minutes: 5,
      }),
    ];

    // Badge-only events (user not in planning)
    const badgeOnlyEvents: BadgeEvent[] = [
      makeEvent({
        user_id: "extra-1",
        event_type: "clock_in",
        effective_at: "2026-01-15T07:30:00Z", // 08:30 Paris
      }),
      makeEvent({
        user_id: "extra-1",
        event_type: "clock_out",
        effective_at: "2026-01-15T15:00:00Z", // 16:00 Paris
      }),
    ];

    const allEvents = [...planningEvents, ...badgeOnlyEvents];

    // Compute planning-based presence
    const employees = computePresenceData(shifts, planningEvents, "18:00");
    const cards = groupByEmployee(employees);

    // Merge badge-only users
    const profilesMap = new Map([["extra-1", "Bob Extra"]]);
    const merged = mergeBadgeOnlyUsers(cards, allEvents, profilesMap);

    expect(merged).toHaveLength(2);

    // First: planning user
    expect(merged[0].source).toBe("planning");
    expect(merged[0].fullName).toBe("Alice Planned");
    expect(merged[0].totalLateMinutes).toBe(5);

    // Second: badge-only user
    expect(merged[1].source).toBe("badge_only");
    expect(merged[1].fullName).toBe("Bob Extra");
    expect(merged[1].totalLateMinutes).toBe(0); // Cannot be late without a plan
    expect(merged[1].sessions).toHaveLength(1);
    expect(merged[1].sessions[0].plannedStart).toBe("--:--");
    expect(merged[1].sessions[0].plannedEnd).toBe("--:--");
    expect(merged[1].sessions[0].clockIn).toBe("08:30");
    expect(merged[1].sessions[0].clockOut).toBe("16:00");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: Multi-employee restaurant scenario
// ─────────────────────────────────────────────────────────────────────────────

describe("Full restaurant scenario: multiple employees, various states", () => {
  it("simulates a busy day with 4 employees in different states", () => {
    const shifts: PlannedShift[] = [
      // Chef: morning and evening shifts
      makeShift({
        user_id: "chef",
        start_time: "08:00",
        end_time: "14:00",
        sequence_index: 1,
        profiles: { full_name: "Chef Pierre" },
      }),
      makeShift({
        user_id: "chef",
        start_time: "18:00",
        end_time: "22:00",
        sequence_index: 2,
        profiles: { full_name: "Chef Pierre" },
      }),
      // Server: single shift, will be late
      makeShift({
        user_id: "server",
        start_time: "11:00",
        end_time: "15:00",
        sequence_index: 1,
        profiles: { full_name: "Marie Serveur" },
      }),
      // Dishwasher: single shift, will be absent
      makeShift({
        user_id: "dish",
        start_time: "09:00",
        end_time: "14:00",
        sequence_index: 1,
        profiles: { full_name: "Jean Plonge" },
      }),
      // Night cook: evening shift, not started yet
      makeShift({
        user_id: "night",
        start_time: "20:00",
        end_time: "01:00",
        sequence_index: 1,
        profiles: { full_name: "Night Cook" },
      }),
    ];

    const events: BadgeEvent[] = [
      // Chef: on time for morning, not yet arrived for evening
      makeEvent({
        user_id: "chef",
        event_type: "clock_in",
        sequence_index: 1,
        late_minutes: 0,
      }),
      makeEvent({
        user_id: "chef",
        event_type: "clock_out",
        sequence_index: 1,
        early_departure_minutes: 0,
      }),
      // Server: 20 min late
      makeEvent({
        user_id: "server",
        event_type: "clock_in",
        sequence_index: 1,
        late_minutes: 20,
      }),
      // Dishwasher: no events (absent)
      // Night cook: no events (not started yet)
    ];

    const nowParis = "15:00"; // 3 PM
    const employees = computePresenceData(shifts, events, nowParis, "03:00");
    const cards = groupByEmployee(employees);

    // Chef: 2 sessions
    const chefCard = cards.find((c) => c.fullName === "Chef Pierre")!;
    expect(chefCard).toBeDefined();
    expect(chefCard.sessions).toHaveLength(2);
    // Morning: present and done
    const chefMorning = chefCard.sessions.find((s) => s.sequenceIndex === 1)!;
    expect(chefMorning.status).toBe("present");
    // Evening: not started yet (18:00 > 15:00)
    const chefEvening = chefCard.sessions.find((s) => s.sequenceIndex === 2)!;
    expect(chefEvening.isNotStartedYet).toBe(true);

    // Server: present, late
    const serverCard = cards.find((c) => c.fullName === "Marie Serveur")!;
    expect(serverCard).toBeDefined();
    expect(serverCard.sessions[0].status).toBe("present");
    expect(serverCard.totalLateMinutes).toBe(20);

    // Dishwasher: absent (shift 09:00-14:00 is finished at 15:00)
    const dishCard = cards.find((c) => c.fullName === "Jean Plonge")!;
    expect(dishCard).toBeDefined();
    expect(dishCard.sessions[0].status).toBe("absent");
    expect(dishCard.sessions[0].isFinishedWithoutClockIn).toBe(true);

    // Night cook: not started yet (20:00 > 15:00)
    const nightCard = cards.find((c) => c.fullName === "Night Cook")!;
    expect(nightCard).toBeDefined();
    expect(nightCard.sessions[0].isNotStartedYet).toBe(true);

    // Verify sorting (alphabetical by name)
    const names = cards.map((c) => c.fullName);
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sortedNames);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: Orphan events and edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("Orphan events and edge cases", () => {
  it("clock_out without clock_in produces unknown status", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "09:00",
        end_time: "17:00",
      }),
    ];

    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_out",
        sequence_index: 1,
      }),
    ];

    const employees = computePresenceData(shifts, events, "18:00");
    expect(employees[0].status).toBe("unknown");
    expect(employees[0].clockInEvent).toBeNull();
    expect(employees[0].clockOutEvent).not.toBeNull();
  });

  it("events for non-matching sequence_index are ignored", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "09:00",
        end_time: "17:00",
        sequence_index: 1,
      }),
    ];

    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        sequence_index: 2, // Does not match shift sequence 1
        late_minutes: 0,
      }),
    ];

    const employees = computePresenceData(shifts, events, "18:00");
    // No matching event for sequence 1 => absent
    expect(employees[0].status).toBe("absent");
    expect(employees[0].clockInEvent).toBeNull();
  });

  it("empty shifts array produces empty result", () => {
    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
      }),
    ];

    const result = computePresenceData([], events, "12:00");
    expect(result).toEqual([]);
  });

  it("formatLateMinutes returns empty for 0 or negative", () => {
    expect(formatLateMinutes(0)).toBe("");
    expect(formatLateMinutes(-5)).toBe("");
  });

  it("formatLateMinutes formats positive values correctly", () => {
    expect(formatLateMinutes(8)).toBe("0h08");
    expect(formatLateMinutes(60)).toBe("1h00");
    expect(formatLateMinutes(135)).toBe("2h15");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: Summer time (CEST) correctness
// ─────────────────────────────────────────────────────────────────────────────

describe("Summer time (CEST = UTC+2) correctness", () => {
  it("isoToHHMM correctly handles summer time offset", () => {
    // July 15, 08:00 UTC = 10:00 Paris (CEST)
    expect(isoToHHMM("2026-07-15T08:00:00Z")).toBe("10:00");
    // July 15, 06:30 UTC = 08:30 Paris (CEST)
    expect(isoToHHMM("2026-07-15T06:30:00Z")).toBe("08:30");
    // July 15, 22:00 UTC = 00:00 next day Paris (CEST)
    expect(isoToHHMM("2026-07-15T22:00:00Z")).toBe("00:00");
  });

  it("computeLateMinutes works correctly in summer time", () => {
    // Shift starts 09:00 Paris, badge at 09:15 Paris
    // 09:15 Paris CEST = 07:15 UTC
    const result = computeLateMinutes("2026-07-15T07:15:00Z", "09:00");
    expect(result).toBe(15);
  });
});
