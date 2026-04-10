/**
 * Additional tests for presence.compute.ts — Edge cases
 *
 * Covers: overnight shifts with various cutoffs, zero hours,
 * employees with no badges, partial badges, multiple shifts per day,
 * groupByEmployee edge cases, mergeBadgeOnlyUsers extended scenarios.
 *
 * All times use Europe/Paris timezone (CET = UTC+1, CEST = UTC+2).
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
  type PresenceEmployeeCard,
} from "../presence.compute";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeShift(
  overrides: Partial<PlannedShift> & { user_id: string; start_time: string; end_time: string }
): PlannedShift {
  return {
    sequence_index: 1,
    profiles: { full_name: "Test Employé" },
    ...overrides,
  };
}

function makeEvent(
  overrides: Partial<BadgeEvent> & {
    user_id: string;
    event_type: string;
  }
): BadgeEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    occurred_at: "2026-01-15T08:00:00Z",
    effective_at: "2026-01-15T08:00:00Z",
    day_date: "2026-01-15",
    sequence_index: 1,
    late_minutes: null,
    early_departure_minutes: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Overnight shifts with different cutoffs
// ═══════════════════════════════════════════════════════════════════════════════

describe("computePresenceData — overnight shifts edge cases", () => {
  it("handles late-night shift ending at exactly the cutoff (02:00 end, 03:00 cutoff)", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "20:00", end_time: "02:00" }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 1, late_minutes: 0 }),
    ];

    // At 02:30 (after end but before cutoff) -> shift is finished
    const result = computePresenceData(shifts, events, "02:30", "03:00");
    expect(result[0].status).toBe("present");
    expect(result[0].isFinishedWithoutClockOut).toBe(true);
  });

  it("handles cutoff at 05:00 with shift ending at 04:00", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "21:00", end_time: "04:00" }),
    ];

    // At 04:30, cutoff 05:00, no badge
    const result = computePresenceData(shifts, [], "04:30", "05:00");
    expect(result[0].status).toBe("absent");
    expect(result[0].isFinishedWithoutClockIn).toBe(true);
  });

  it("handles shift starting at cutoff boundary (03:00 start, 03:00 cutoff)", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "03:00", end_time: "11:00" }),
    ];

    const result = computePresenceData(shifts, [], "04:00", "03:00");
    expect(result[0].isNotStartedYet).toBe(false); // shift has started
    expect(result[0].isFinishedWithoutClockIn).toBe(false); // not finished yet
  });

  it("handles shift that spans from before cutoff to after cutoff", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "01:00", end_time: "06:00" }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 1, late_minutes: 0 }),
    ];

    // 01:00 < cutoff 03:00 => normalized to 01:00 + 1440 = 1500
    // 06:00 >= cutoff => stays at 360
    // But 360 < 1500 => end gets +1440 = 1800
    // At 05:00 >= cutoff => normalized 300, 300 < 1500 => not started?
    // Actually 05:00 is after cutoff, so 300, and 300 < 1500 means not started
    // This is because the shift is meant for the "next service day"
    const result = computePresenceData(shifts, events, "05:00", "03:00");
    expect(result[0].status).toBe("present");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Zero-length and very short shifts
// ═══════════════════════════════════════════════════════════════════════════════

describe("computePresenceData — zero and short shifts", () => {
  it("handles shift with same start and end time", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "09:00", end_time: "09:00" }),
    ];

    const result = computePresenceData(shifts, [], "10:00");
    expect(result).toHaveLength(1);
    // start == end means duration is 0 or it wraps around
    expect(result[0].status).toBe("absent");
  });

  it("handles 30-minute shift", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "12:00", end_time: "12:30" }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 1, late_minutes: 0 }),
    ];

    const result = computePresenceData(shifts, events, "13:00");
    expect(result[0].status).toBe("present");
    expect(result[0].isFinishedWithoutClockOut).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Employees with partial badges (clock_in only, clock_out only)
// ═══════════════════════════════════════════════════════════════════════════════

describe("computePresenceData — partial badges", () => {
  it("handles clock_in only during shift (shift still in progress)", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 1, late_minutes: 5 }),
    ];

    const result = computePresenceData(shifts, events, "12:00");
    expect(result[0].status).toBe("present");
    expect(result[0].clockInEvent).not.toBeNull();
    expect(result[0].clockOutEvent).toBeNull();
    expect(result[0].isFinishedWithoutClockOut).toBe(false);
  });

  it("handles clock_out only (orphan) during shift", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_out", sequence_index: 1 }),
    ];

    const result = computePresenceData(shifts, events, "18:00");
    expect(result[0].status).toBe("unknown");
    expect(result[0].clockInEvent).toBeNull();
    expect(result[0].clockOutEvent).not.toBeNull();
  });

  it("handles late badge with large late_minutes from DB", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        sequence_index: 1,
        late_minutes: 120, // 2 hours late
      }),
    ];

    const result = computePresenceData(shifts, events, "12:00");
    expect(result[0].lateMinutes).toBe(120);
    expect(result[0].cumulativeLateMinutes).toBe(120);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Multiple shifts per day — advanced scenarios
// ═══════════════════════════════════════════════════════════════════════════════

describe("computePresenceData — triple shift per user", () => {
  it("handles three shifts for one employee", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "07:00", end_time: "11:00", sequence_index: 1 }),
      makeShift({ user_id: "u1", start_time: "12:00", end_time: "15:00", sequence_index: 2 }),
      makeShift({ user_id: "u1", start_time: "18:00", end_time: "22:00", sequence_index: 3 }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 1, late_minutes: 0 }),
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 2, late_minutes: 5 }),
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 3, late_minutes: 10 }),
    ];

    const result = computePresenceData(shifts, events, "23:00");
    expect(result).toHaveLength(3);

    const seq1 = result.find((r) => r.sequenceIndex === 1)!;
    const seq2 = result.find((r) => r.sequenceIndex === 2)!;
    const seq3 = result.find((r) => r.sequenceIndex === 3)!;

    expect(seq1.lateMinutes).toBe(0);
    expect(seq2.lateMinutes).toBe(5);
    expect(seq3.lateMinutes).toBe(10);

    // Cumulative: 0, 0+5=5, 5+10=15
    expect(seq1.cumulativeLateMinutes).toBe(0);
    expect(seq2.cumulativeLateMinutes).toBe(5);
    expect(seq3.cumulativeLateMinutes).toBe(15);
  });

  it("handles absent from first shift, present for second", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "07:00", end_time: "11:00", sequence_index: 1 }),
      makeShift({ user_id: "u1", start_time: "14:00", end_time: "18:00", sequence_index: 2 }),
    ];
    const events: BadgeEvent[] = [
      // No clock_in for sequence 1, only for sequence 2
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 2, late_minutes: 0 }),
    ];

    const result = computePresenceData(shifts, events, "19:00");

    const seq1 = result.find((r) => r.sequenceIndex === 1)!;
    const seq2 = result.find((r) => r.sequenceIndex === 2)!;

    expect(seq1.status).toBe("absent");
    expect(seq1.isFinishedWithoutClockIn).toBe(true);
    expect(seq2.status).toBe("present");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Multiple employees with mixed statuses
// ═══════════════════════════════════════════════════════════════════════════════

describe("computePresenceData — multiple employees mixed", () => {
  it("correctly processes 3 employees: present, absent, orphan", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "09:00",
        end_time: "17:00",
        profiles: { full_name: "Alice" },
      }),
      makeShift({
        user_id: "u2",
        start_time: "09:00",
        end_time: "17:00",
        profiles: { full_name: "Bob" },
      }),
      makeShift({
        user_id: "u3",
        start_time: "09:00",
        end_time: "17:00",
        profiles: { full_name: "Charlie" },
      }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 1, late_minutes: 0 }),
      // u2: no events -> absent
      makeEvent({ user_id: "u3", event_type: "clock_out", sequence_index: 1 }), // orphan
    ];

    const result = computePresenceData(shifts, events, "18:00");
    expect(result).toHaveLength(3);

    const alice = result.find((r) => r.fullName === "Alice")!;
    const bob = result.find((r) => r.fullName === "Bob")!;
    const charlie = result.find((r) => r.fullName === "Charlie")!;

    expect(alice.status).toBe("present");
    expect(bob.status).toBe("absent");
    expect(bob.isFinishedWithoutClockIn).toBe(true);
    expect(charlie.status).toBe("unknown");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// groupByEmployee — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("groupByEmployee — additional edge cases", () => {
  it("handles single employee with single shift", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 1, late_minutes: 0 }),
    ];

    const employees = computePresenceData(shifts, events, "12:00");
    const cards = groupByEmployee(employees);

    expect(cards).toHaveLength(1);
    expect(cards[0].sessions).toHaveLength(1);
    expect(cards[0].totalLateMinutes).toBe(0);
  });

  it("handles two employees each with two shifts", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u1",
        start_time: "09:00",
        end_time: "14:00",
        sequence_index: 1,
        profiles: { full_name: "Alice" },
      }),
      makeShift({
        user_id: "u1",
        start_time: "18:00",
        end_time: "22:00",
        sequence_index: 2,
        profiles: { full_name: "Alice" },
      }),
      makeShift({
        user_id: "u2",
        start_time: "10:00",
        end_time: "15:00",
        sequence_index: 1,
        profiles: { full_name: "Bob" },
      }),
      makeShift({
        user_id: "u2",
        start_time: "19:00",
        end_time: "23:00",
        sequence_index: 2,
        profiles: { full_name: "Bob" },
      }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 1, late_minutes: 3 }),
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 2, late_minutes: 7 }),
      makeEvent({ user_id: "u2", event_type: "clock_in", sequence_index: 1, late_minutes: 0 }),
      makeEvent({ user_id: "u2", event_type: "clock_in", sequence_index: 2, late_minutes: 15 }),
    ];

    const employees = computePresenceData(shifts, events, "23:30");
    const cards = groupByEmployee(employees);

    expect(cards).toHaveLength(2);

    const aliceCard = cards.find((c) => c.fullName === "Alice")!;
    const bobCard = cards.find((c) => c.fullName === "Bob")!;

    expect(aliceCard.sessions).toHaveLength(2);
    expect(aliceCard.totalLateMinutes).toBe(10); // 3 + 7
    expect(bobCard.sessions).toHaveLength(2);
    expect(bobCard.totalLateMinutes).toBe(15); // 0 + 15
  });

  it("only counts present shifts in totalLateMinutes (absent shifts = 0 late)", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "09:00", end_time: "14:00", sequence_index: 1 }),
      makeShift({ user_id: "u1", start_time: "18:00", end_time: "22:00", sequence_index: 2 }),
    ];
    // Only present for second shift
    const events: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 2, late_minutes: 20 }),
    ];

    const employees = computePresenceData(shifts, events, "23:00");
    const cards = groupByEmployee(employees);

    expect(cards).toHaveLength(1);
    expect(cards[0].totalLateMinutes).toBe(20); // not 0 + 20, first shift is absent not late
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// mergeBadgeOnlyUsers — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("mergeBadgeOnlyUsers — additional edge cases", () => {
  it("handles multiple badge-only users", () => {
    const existingCards: PresenceEmployeeCard[] = [];
    const allEvents: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in" }),
      makeEvent({ user_id: "u2", event_type: "clock_in" }),
      makeEvent({ user_id: "u3", event_type: "clock_in" }),
    ];
    const profilesMap = new Map([
      ["u1", "Charlie"],
      ["u2", "Alice"],
      ["u3", "Bob"],
    ]);

    const merged = mergeBadgeOnlyUsers(existingCards, allEvents, profilesMap);

    expect(merged).toHaveLength(3);
    // Should be sorted alphabetically
    expect(merged[0].fullName).toBe("Alice");
    expect(merged[1].fullName).toBe("Bob");
    expect(merged[2].fullName).toBe("Charlie");
    // All should be badge_only source
    expect(merged.every((c) => c.source === "badge_only")).toBe(true);
  });

  it("preserves existing cards source as 'planning'", () => {
    const existingCards: PresenceEmployeeCard[] = [
      {
        userId: "u1",
        fullName: "Planning User",
        sessions: [],
        allEvents: [],
        totalLateMinutes: 0,
        cumulativeLateMinutes: 0,
      },
    ];

    const merged = mergeBadgeOnlyUsers(existingCards, [], new Map());
    expect(merged[0].source).toBe("planning");
  });

  it("badge-only user with only clock_out has unknown status", () => {
    const existingCards: PresenceEmployeeCard[] = [];
    const allEvents: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_out", effective_at: "2026-01-15T16:00:00Z" }),
    ];
    const profilesMap = new Map([["u1", "Orphan User"]]);

    const merged = mergeBadgeOnlyUsers(existingCards, allEvents, profilesMap);

    expect(merged).toHaveLength(1);
    expect(merged[0].sessions[0].status).toBe("unknown");
    expect(merged[0].sessions[0].clockIn).toBeNull();
    expect(merged[0].sessions[0].clockOut).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// computeLateMinutes — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeLateMinutes — additional edge cases", () => {
  it("returns 0 when exactly on time", () => {
    // 09:00 UTC = 10:00 Paris, planned 10:00
    expect(computeLateMinutes("2026-01-15T09:00:00Z", "10:00")).toBe(0);
  });

  it("handles 1-minute late", () => {
    // 09:01 UTC = 10:01 Paris, planned 10:00
    expect(computeLateMinutes("2026-01-15T09:01:00Z", "10:00")).toBe(1);
  });

  it("handles very early arrival (negative not clamped below 0)", () => {
    // 07:00 UTC = 08:00 Paris, planned 10:00 => -120 => clamped to 0
    expect(computeLateMinutes("2026-01-15T07:00:00Z", "10:00")).toBe(0);
  });

  it("handles summer time for late calculation", () => {
    // Summer CEST: 09:15 UTC = 11:15 Paris, planned 11:00 => 15 min late
    expect(computeLateMinutes("2026-07-15T09:15:00Z", "11:00")).toBe(15);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatLateMinutes — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatLateMinutes — additional edge cases", () => {
  it("returns empty for exactly 0", () => {
    expect(formatLateMinutes(0)).toBe("");
  });

  it("formats 1 minute", () => {
    expect(formatLateMinutes(1)).toBe("0h01");
  });

  it("formats 420 minutes (7h)", () => {
    expect(formatLateMinutes(420)).toBe("7h00");
  });

  it("returns empty for large negative", () => {
    expect(formatLateMinutes(-100)).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// isoToHHMM — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("isoToHHMM — additional edge cases", () => {
  it("handles ISO string with milliseconds", () => {
    expect(isoToHHMM("2026-01-15T08:30:45.123Z")).toBe("09:30");
  });

  it("handles Supabase format with +01 offset", () => {
    // +01 means already in CET. 09:00+01 = 08:00 UTC = 09:00 Paris CET
    expect(isoToHHMM("2026-01-15 09:00:00+01")).toBe("09:00");
  });
});
