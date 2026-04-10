/**
 * Tests for presence.compute.ts — Presence computation engine
 *
 * Covers: isoToHHMM, computeLateMinutes, computePresenceData,
 *         groupByEmployee, mergeBadgeOnlyUsers, formatLateMinutes
 *
 * All times use Europe/Paris timezone (CET = UTC+1, CEST = UTC+2).
 * ISO timestamps in helpers below are in UTC for determinism.
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
// Helpers — build test fixtures concisely
// ---------------------------------------------------------------------------

/** Build a PlannedShift with sensible defaults */
function makeShift(
  overrides: Partial<PlannedShift> & { user_id: string; start_time: string; end_time: string }
): PlannedShift {
  return {
    sequence_index: 1,
    profiles: { full_name: "Jean Dupont" },
    ...overrides,
  };
}

/**
 * Build a BadgeEvent with sensible defaults.
 * effective_at and occurred_at default to a CET winter timestamp (UTC+1)
 * so "09:15" Paris => "08:15Z" in UTC.
 */
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

// ---------------------------------------------------------------------------
// isoToHHMM
// ---------------------------------------------------------------------------

describe("isoToHHMM", () => {
  it("converts a UTC ISO string to Paris HH:mm (winter CET = UTC+1)", () => {
    // 2026-01-15 = winter => CET (UTC+1) => 08:00 UTC = 09:00 Paris
    expect(isoToHHMM("2026-01-15T08:00:00Z")).toBe("09:00");
  });

  it("converts a UTC ISO string to Paris HH:mm (summer CEST = UTC+2)", () => {
    // 2026-07-15 = summer => CEST (UTC+2) => 08:00 UTC = 10:00 Paris
    expect(isoToHHMM("2026-07-15T08:00:00Z")).toBe("10:00");
  });

  it("handles midnight UTC in winter (becomes 01:00 Paris)", () => {
    expect(isoToHHMM("2026-01-15T00:00:00Z")).toBe("01:00");
  });

  it("handles 23:00 UTC in winter (becomes 00:00 next day Paris)", () => {
    expect(isoToHHMM("2026-01-15T23:00:00Z")).toBe("00:00");
  });

  it("handles Supabase format with space instead of T", () => {
    expect(isoToHHMM("2026-01-15 08:00:00+00")).toBe("09:00");
  });

  it("returns --:-- for invalid input", () => {
    expect(isoToHHMM("not-a-date")).toBe("--:--");
  });
});

// ---------------------------------------------------------------------------
// computeLateMinutes
// ---------------------------------------------------------------------------

describe("computeLateMinutes", () => {
  it("returns 0 when employee arrives on time", () => {
    // 09:00 UTC = 10:00 Paris, planned 10:00
    const result = computeLateMinutes("2026-01-15T09:00:00Z", "10:00");
    expect(result).toBe(0);
  });

  it("returns 0 when employee arrives early", () => {
    // 08:30 UTC = 09:30 Paris, planned 10:00
    const result = computeLateMinutes("2026-01-15T08:30:00Z", "10:00");
    expect(result).toBe(0);
  });

  it("computes correct late minutes", () => {
    // 09:15 UTC = 10:15 Paris, planned 10:00 => 15 minutes late
    const result = computeLateMinutes("2026-01-15T09:15:00Z", "10:00");
    expect(result).toBe(15);
  });

  it("computes late minutes for larger delay", () => {
    // 10:00 UTC = 11:00 Paris, planned 09:00 => 120 minutes late
    const result = computeLateMinutes("2026-01-15T10:00:00Z", "09:00");
    expect(result).toBe(120);
  });

  it("handles planned time with seconds suffix (HH:mm:ss)", () => {
    // 09:10 UTC = 10:10 Paris, planned 10:00:00 => 10 minutes late
    const result = computeLateMinutes("2026-01-15T09:10:00Z", "10:00:00");
    expect(result).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// formatLateMinutes
// ---------------------------------------------------------------------------

describe("formatLateMinutes", () => {
  it("returns empty string for 0 minutes", () => {
    expect(formatLateMinutes(0)).toBe("");
  });

  it("returns empty string for negative minutes", () => {
    expect(formatLateMinutes(-5)).toBe("");
  });

  it("formats small late minutes (under 1 hour)", () => {
    // minutesToXhYY(8) = "0h08"
    expect(formatLateMinutes(8)).toBe("0h08");
  });

  it("formats exactly 1 hour", () => {
    expect(formatLateMinutes(60)).toBe("1h00");
  });

  it("formats minutes over 1 hour", () => {
    expect(formatLateMinutes(135)).toBe("2h15");
  });
});

// ---------------------------------------------------------------------------
// computePresenceData — core engine
// ---------------------------------------------------------------------------

describe("computePresenceData", () => {
  // -----------------------------------------------------------------------
  // Empty / degenerate inputs
  // -----------------------------------------------------------------------

  describe("empty inputs", () => {
    it("returns empty array when no shifts and no events", () => {
      const result = computePresenceData([], []);
      expect(result).toEqual([]);
    });

    it("returns empty array when only badge events exist (no shifts)", () => {
      const events = [makeEvent({ user_id: "u1", event_type: "clock_in" })];
      // No shifts => shiftsByUser is empty => loop does not run
      const result = computePresenceData([], events);
      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Normal presence — on-time badge in and badge out
  // -----------------------------------------------------------------------

  describe("normal presence (on-time badge)", () => {
    it("marks employee as present when clock_in exists", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
      ];
      const events: BadgeEvent[] = [
        makeEvent({
          user_id: "u1",
          event_type: "clock_in",
          sequence_index: 1,
          late_minutes: 0,
        }),
      ];

      const result = computePresenceData(shifts, events, "12:00");
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("present");
      expect(result[0].lateMinutes).toBe(0);
      expect(result[0].isNotStartedYet).toBe(false);
      expect(result[0].isFinishedWithoutClockIn).toBe(false);
      expect(result[0].isFinishedWithoutClockOut).toBe(false);
    });

    it("includes both clock_in and clock_out events", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
      ];
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
          early_departure_minutes: 0,
        }),
      ];

      const result = computePresenceData(shifts, events, "18:00");
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("present");
      expect(result[0].clockInEvent).not.toBeNull();
      expect(result[0].clockOutEvent).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Late arrival
  // -----------------------------------------------------------------------

  describe("late arrival", () => {
    it("uses late_minutes from DB badge event (SSOT)", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
      ];
      const events: BadgeEvent[] = [
        makeEvent({
          user_id: "u1",
          event_type: "clock_in",
          sequence_index: 1,
          late_minutes: 15,
        }),
      ];

      const result = computePresenceData(shifts, events, "12:00");
      expect(result[0].status).toBe("present");
      expect(result[0].lateMinutes).toBe(15);
    });

    it("defaults late_minutes to 0 when DB field is null (old data)", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
      ];
      const events: BadgeEvent[] = [
        makeEvent({
          user_id: "u1",
          event_type: "clock_in",
          sequence_index: 1,
          late_minutes: null,
        }),
      ];

      const result = computePresenceData(shifts, events, "12:00");
      expect(result[0].lateMinutes).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Absence — shift finished, no badge events
  // -----------------------------------------------------------------------

  describe("absence", () => {
    it("marks absent when shift is finished and no badge events", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
      ];

      const result = computePresenceData(shifts, [], "18:00");
      expect(result[0].status).toBe("absent");
      expect(result[0].isFinishedWithoutClockIn).toBe(true);
      expect(result[0].isNotStartedYet).toBe(false);
    });

    it("does NOT count absence as late minutes (absence != retard)", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
      ];

      const result = computePresenceData(shifts, [], "18:00");
      expect(result[0].lateMinutes).toBe(0);
      expect(result[0].cumulativeLateMinutes).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Shift not started yet — future shift
  // -----------------------------------------------------------------------

  describe("shift not started yet", () => {
    it("sets isNotStartedYet when now < shift start and no badges", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "18:00", end_time: "23:00" }),
      ];

      const result = computePresenceData(shifts, [], "10:00");
      expect(result[0].status).toBe("absent"); // status remains absent
      expect(result[0].isNotStartedYet).toBe(true);
      expect(result[0].isFinishedWithoutClockIn).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Shift started but not finished, no badge
  // -----------------------------------------------------------------------

  describe("shift in progress, no badge", () => {
    it("is absent (not isNotStartedYet, not isFinishedWithoutClockIn) during shift without badge", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
      ];

      const result = computePresenceData(shifts, [], "12:00");
      expect(result[0].status).toBe("absent");
      expect(result[0].isNotStartedYet).toBe(false);
      expect(result[0].isFinishedWithoutClockIn).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Forgotten clock-out (has clock_in, no clock_out, shift finished)
  // -----------------------------------------------------------------------

  describe("forgotten clock-out", () => {
    it("sets isFinishedWithoutClockOut when shift is done and only clock_in exists", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
      ];
      const events: BadgeEvent[] = [
        makeEvent({
          user_id: "u1",
          event_type: "clock_in",
          sequence_index: 1,
          late_minutes: 0,
        }),
      ];

      const result = computePresenceData(shifts, events, "18:00");
      expect(result[0].status).toBe("present");
      expect(result[0].isFinishedWithoutClockOut).toBe(true);
      expect(result[0].clockOutEvent).toBeNull();
    });

    it("does NOT set isFinishedWithoutClockOut when shift is still in progress", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
      ];
      const events: BadgeEvent[] = [
        makeEvent({
          user_id: "u1",
          event_type: "clock_in",
          sequence_index: 1,
          late_minutes: 0,
        }),
      ];

      const result = computePresenceData(shifts, events, "14:00");
      expect(result[0].status).toBe("present");
      expect(result[0].isFinishedWithoutClockOut).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Orphan badge — clock_out without clock_in
  // -----------------------------------------------------------------------

  describe("orphan badge (clock_out without clock_in)", () => {
    it("marks status as unknown for orphan clock_out", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
      ];
      const events: BadgeEvent[] = [
        makeEvent({
          user_id: "u1",
          event_type: "clock_out",
          sequence_index: 1,
        }),
      ];

      const result = computePresenceData(shifts, events, "18:00");
      expect(result[0].status).toBe("unknown");
      expect(result[0].clockInEvent).toBeNull();
      expect(result[0].clockOutEvent).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Night shift (crosses midnight)
  // -----------------------------------------------------------------------

  describe("night shift (crosses midnight)", () => {
    it("correctly handles overnight shift with cutoff 03:00", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "22:00", end_time: "02:00" }),
      ];
      const events: BadgeEvent[] = [
        makeEvent({
          user_id: "u1",
          event_type: "clock_in",
          sequence_index: 1,
          late_minutes: 0,
        }),
      ];

      // At 23:00, shift is in progress
      const result = computePresenceData(shifts, events, "23:00", "03:00");
      expect(result[0].status).toBe("present");
      expect(result[0].isFinishedWithoutClockOut).toBe(false);
    });

    it("marks night shift as finished after end time (post-midnight)", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "22:00", end_time: "02:00" }),
      ];

      // At 02:30 with cutoff 03:00, shift has finished, no badge => absent
      const result = computePresenceData(shifts, [], "02:30", "03:00");
      expect(result[0].status).toBe("absent");
      expect(result[0].isFinishedWithoutClockIn).toBe(true);
    });

    it("marks night shift as not started when before start time", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "22:00", end_time: "02:00" }),
      ];

      // At 18:00, shift has not started
      const result = computePresenceData(shifts, [], "18:00", "03:00");
      expect(result[0].isNotStartedYet).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple shifts per user (split shifts)
  // -----------------------------------------------------------------------

  describe("multiple shifts per user", () => {
    it("produces one entry per shift with correct sequence indices", () => {
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
      const events: BadgeEvent[] = [
        makeEvent({
          user_id: "u1",
          event_type: "clock_in",
          sequence_index: 1,
          late_minutes: 0,
        }),
        makeEvent({
          user_id: "u1",
          event_type: "clock_in",
          sequence_index: 2,
          late_minutes: 10,
        }),
      ];

      const result = computePresenceData(shifts, events, "20:00");
      expect(result).toHaveLength(2);

      const seq1 = result.find((r) => r.sequenceIndex === 1);
      const seq2 = result.find((r) => r.sequenceIndex === 2);
      expect(seq1).toBeDefined();
      expect(seq2).toBeDefined();
      expect(seq1!.lateMinutes).toBe(0);
      expect(seq2!.lateMinutes).toBe(10);
    });

    it("accumulates cumulative late minutes across shifts", () => {
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
      const events: BadgeEvent[] = [
        makeEvent({
          user_id: "u1",
          event_type: "clock_in",
          sequence_index: 1,
          late_minutes: 5,
        }),
        makeEvent({
          user_id: "u1",
          event_type: "clock_in",
          sequence_index: 2,
          late_minutes: 10,
        }),
      ];

      const result = computePresenceData(shifts, events, "20:00");
      // First shift: cumulative = 0 + 5 = 5
      // Second shift: cumulative = 5 + 10 = 15
      const seq1 = result.find((r) => r.sequenceIndex === 1);
      const seq2 = result.find((r) => r.sequenceIndex === 2);
      expect(seq1!.cumulativeLateMinutes).toBe(5);
      expect(seq2!.cumulativeLateMinutes).toBe(15);
    });

    it("does NOT accumulate absence into cumulative late minutes", () => {
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
      // Only clock_in for shift 2, absent from shift 1
      const events: BadgeEvent[] = [
        makeEvent({
          user_id: "u1",
          event_type: "clock_in",
          sequence_index: 2,
          late_minutes: 10,
        }),
      ];

      const result = computePresenceData(shifts, events, "23:30");
      const seq1 = result.find((r) => r.sequenceIndex === 1);
      const seq2 = result.find((r) => r.sequenceIndex === 2);
      // First shift absent: cumulative stays 0
      expect(seq1!.cumulativeLateMinutes).toBe(0);
      // Second shift: cumulative = 0 + 10 = 10 (not polluted by absence)
      expect(seq2!.cumulativeLateMinutes).toBe(10);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple employees
  // -----------------------------------------------------------------------

  describe("multiple employees", () => {
    it("sorts results alphabetically by full name then by sequence index", () => {
      const shifts: PlannedShift[] = [
        makeShift({
          user_id: "u1",
          start_time: "09:00",
          end_time: "17:00",
          profiles: { full_name: "Zoey Martin" },
        }),
        makeShift({
          user_id: "u2",
          start_time: "09:00",
          end_time: "17:00",
          profiles: { full_name: "Alice Bernard" },
        }),
      ];
      const events: BadgeEvent[] = [
        makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 1, late_minutes: 0 }),
        makeEvent({ user_id: "u2", event_type: "clock_in", sequence_index: 1, late_minutes: 0 }),
      ];

      const result = computePresenceData(shifts, events, "12:00");
      expect(result[0].fullName).toBe("Alice Bernard");
      expect(result[1].fullName).toBe("Zoey Martin");
    });
  });

  // -----------------------------------------------------------------------
  // Default full name
  // -----------------------------------------------------------------------

  describe("fallback full name", () => {
    it("uses 'Inconnu' when profiles or full_name is null", () => {
      const shifts: PlannedShift[] = [
        makeShift({
          user_id: "u1",
          start_time: "09:00",
          end_time: "17:00",
          profiles: { full_name: null },
        }),
      ];

      const result = computePresenceData(shifts, [], "18:00");
      expect(result[0].fullName).toBe("Inconnu");
    });

    it("uses 'Inconnu' when profiles is undefined", () => {
      const shift: PlannedShift = {
        user_id: "u1",
        start_time: "09:00",
        end_time: "17:00",
      };

      const result = computePresenceData([shift], [], "18:00");
      expect(result[0].fullName).toBe("Inconnu");
    });
  });

  // -----------------------------------------------------------------------
  // Default nowParisHHMM (fallback to "23:59")
  // -----------------------------------------------------------------------

  describe("default nowParisHHMM", () => {
    it("treats shift as finished when nowParisHHMM is omitted (defaults to 23:59)", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
      ];

      // No nowParisHHMM => defaults to 23:59, shift 09-17 is finished
      const result = computePresenceData(shifts, []);
      expect(result[0].isFinishedWithoutClockIn).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // sequence_index defaulting
  // -----------------------------------------------------------------------

  describe("sequence_index defaults", () => {
    it("defaults sequence_index to 1 when undefined on shift", () => {
      const shift: PlannedShift = {
        user_id: "u1",
        start_time: "09:00",
        end_time: "17:00",
        // sequence_index not set
        profiles: { full_name: "Test" },
      };
      const events: BadgeEvent[] = [
        makeEvent({
          user_id: "u1",
          event_type: "clock_in",
          sequence_index: 1,
          late_minutes: 0,
        }),
      ];

      const result = computePresenceData([shift], events, "12:00");
      expect(result[0].status).toBe("present");
      expect(result[0].sequenceIndex).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Event matching by sequence_index
  // -----------------------------------------------------------------------

  describe("event-shift matching by sequence_index", () => {
    it("does not match clock_in from a different sequence_index", () => {
      const shifts: PlannedShift[] = [
        makeShift({ user_id: "u1", start_time: "09:00", end_time: "14:00", sequence_index: 1 }),
      ];
      const events: BadgeEvent[] = [
        makeEvent({
          user_id: "u1",
          event_type: "clock_in",
          sequence_index: 2, // does not match shift's sequence 1
          late_minutes: 0,
        }),
      ];

      const result = computePresenceData(shifts, events, "18:00");
      // No matching clock_in for sequence 1 => absent (shift finished)
      expect(result[0].status).toBe("absent");
      expect(result[0].clockInEvent).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// groupByEmployee
// ---------------------------------------------------------------------------

describe("groupByEmployee", () => {
  it("groups multiple shifts for the same employee into one card", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "09:00", end_time: "14:00", sequence_index: 1 }),
      makeShift({ user_id: "u1", start_time: "18:00", end_time: "23:00", sequence_index: 2 }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 1, late_minutes: 5 }),
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 2, late_minutes: 10 }),
    ];

    const employees = computePresenceData(shifts, events, "23:30");
    const cards = groupByEmployee(employees);

    expect(cards).toHaveLength(1);
    expect(cards[0].userId).toBe("u1");
    expect(cards[0].sessions).toHaveLength(2);
  });

  it("sums totalLateMinutes across sessions (not max)", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "09:00", end_time: "14:00", sequence_index: 1 }),
      makeShift({ user_id: "u1", start_time: "18:00", end_time: "23:00", sequence_index: 2 }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 1, late_minutes: 5 }),
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 2, late_minutes: 10 }),
    ];

    const employees = computePresenceData(shifts, events, "23:30");
    const cards = groupByEmployee(employees);

    expect(cards[0].totalLateMinutes).toBe(15);
    // cumulativeLateMinutes kept in sync for backwards compat
    expect(cards[0].cumulativeLateMinutes).toBe(15);
  });

  it("sorts sessions within a card by sequenceIndex", () => {
    // Insert shifts in reverse order to test sorting
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "18:00", end_time: "23:00", sequence_index: 2 }),
      makeShift({ user_id: "u1", start_time: "09:00", end_time: "14:00", sequence_index: 1 }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 1, late_minutes: 0 }),
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 2, late_minutes: 0 }),
    ];

    const employees = computePresenceData(shifts, events, "23:30");
    const cards = groupByEmployee(employees);

    expect(cards[0].sessions[0].sequenceIndex).toBe(1);
    expect(cards[0].sessions[1].sequenceIndex).toBe(2);
  });

  it("sorts cards alphabetically by full name", () => {
    const shifts: PlannedShift[] = [
      makeShift({
        user_id: "u2",
        start_time: "09:00",
        end_time: "17:00",
        profiles: { full_name: "Zoey" },
      }),
      makeShift({
        user_id: "u1",
        start_time: "09:00",
        end_time: "17:00",
        profiles: { full_name: "Alice" },
      }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in", sequence_index: 1, late_minutes: 0 }),
      makeEvent({ user_id: "u2", event_type: "clock_in", sequence_index: 1, late_minutes: 0 }),
    ];

    const employees = computePresenceData(shifts, events, "12:00");
    const cards = groupByEmployee(employees);

    expect(cards[0].fullName).toBe("Alice");
    expect(cards[1].fullName).toBe("Zoey");
  });

  it("returns empty array for empty input", () => {
    const cards = groupByEmployee([]);
    expect(cards).toEqual([]);
  });

  it("converts clockInEvent effective_at to HH:mm for session clockIn", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
    ];
    // 2026-01-15T08:05:00Z = 09:05 Paris (winter CET)
    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        sequence_index: 1,
        late_minutes: 5,
        effective_at: "2026-01-15T08:05:00Z",
      }),
    ];

    const employees = computePresenceData(shifts, events, "12:00");
    const cards = groupByEmployee(employees);

    expect(cards[0].sessions[0].clockIn).toBe("09:05");
    expect(cards[0].sessions[0].clockOut).toBeNull();
  });

  it("populates earlyDepartureMinutes from clock_out event", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
    ];
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
        early_departure_minutes: 30,
        effective_at: "2026-01-15T15:30:00Z",
      }),
    ];

    const employees = computePresenceData(shifts, events, "18:00");
    const cards = groupByEmployee(employees);

    expect(cards[0].sessions[0].earlyDepartureMinutes).toBe(30);
  });

  it("defaults earlyDepartureMinutes to 0 when clock_out has null early_departure_minutes", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
    ];
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
        early_departure_minutes: null,
        effective_at: "2026-01-15T16:00:00Z",
      }),
    ];

    const employees = computePresenceData(shifts, events, "18:00");
    const cards = groupByEmployee(employees);

    expect(cards[0].sessions[0].earlyDepartureMinutes).toBe(0);
  });

  it("defaults earlyDepartureMinutes to 0 when no clock_out event exists", () => {
    const shifts: PlannedShift[] = [
      makeShift({ user_id: "u1", start_time: "09:00", end_time: "17:00" }),
    ];
    const events: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        sequence_index: 1,
        late_minutes: 0,
      }),
    ];

    const employees = computePresenceData(shifts, events, "12:00");
    const cards = groupByEmployee(employees);

    expect(cards[0].sessions[0].earlyDepartureMinutes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// mergeBadgeOnlyUsers
// ---------------------------------------------------------------------------

describe("mergeBadgeOnlyUsers", () => {
  it("adds badge-only users who are not in the planning", () => {
    const existingCards: PresenceEmployeeCard[] = [
      {
        userId: "u1",
        fullName: "Jean Dupont",
        sessions: [],
        allEvents: [],
        totalLateMinutes: 0,
        cumulativeLateMinutes: 0,
      },
    ];

    const allEvents: BadgeEvent[] = [
      makeEvent({
        user_id: "u2",
        event_type: "clock_in",
        effective_at: "2026-01-15T08:00:00Z",
      }),
    ];

    const profilesMap = new Map([["u2", "Marie Curie"]]);

    const merged = mergeBadgeOnlyUsers(existingCards, allEvents, profilesMap);

    expect(merged).toHaveLength(2);
    // Planning users come first
    expect(merged[0].userId).toBe("u1");
    expect(merged[0].source).toBe("planning");
    // Badge-only users come after
    expect(merged[1].userId).toBe("u2");
    expect(merged[1].source).toBe("badge_only");
    expect(merged[1].fullName).toBe("Marie Curie");
  });

  it("does not duplicate users who are already in planning", () => {
    const existingCards: PresenceEmployeeCard[] = [
      {
        userId: "u1",
        fullName: "Jean Dupont",
        sessions: [],
        allEvents: [],
        totalLateMinutes: 0,
        cumulativeLateMinutes: 0,
      },
    ];

    const allEvents: BadgeEvent[] = [
      makeEvent({
        user_id: "u1", // same user already in planning
        event_type: "clock_in",
      }),
    ];

    const profilesMap = new Map([["u1", "Jean Dupont"]]);

    const merged = mergeBadgeOnlyUsers(existingCards, allEvents, profilesMap);
    expect(merged).toHaveLength(1);
    expect(merged[0].userId).toBe("u1");
  });

  it("ignores events that are not clock_in or clock_out", () => {
    const existingCards: PresenceEmployeeCard[] = [];

    const allEvents: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "break_start", // not clock_in or clock_out
      }),
    ];

    const profilesMap = new Map([["u1", "Test User"]]);

    const merged = mergeBadgeOnlyUsers(existingCards, allEvents, profilesMap);
    expect(merged).toHaveLength(0);
  });

  it("creates synthetic session with --:-- for planned times", () => {
    const existingCards: PresenceEmployeeCard[] = [];

    const allEvents: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        effective_at: "2026-01-15T08:00:00Z",
      }),
    ];

    const profilesMap = new Map([["u1", "Hors Planning"]]);

    const merged = mergeBadgeOnlyUsers(existingCards, allEvents, profilesMap);

    expect(merged).toHaveLength(1);
    const session = merged[0].sessions[0];
    expect(session.plannedStart).toBe("--:--");
    expect(session.plannedEnd).toBe("--:--");
    expect(session.lateMinutes).toBe(0);
    expect(session.earlyDepartureMinutes).toBe(0);
  });

  it("sets status to present when badge-only user has clock_in", () => {
    const existingCards: PresenceEmployeeCard[] = [];

    const allEvents: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        effective_at: "2026-01-15T08:00:00Z",
      }),
    ];

    const profilesMap = new Map([["u1", "Test"]]);

    const merged = mergeBadgeOnlyUsers(existingCards, allEvents, profilesMap);

    expect(merged[0].sessions[0].status).toBe("present");
  });

  it("sets status to unknown when badge-only user has only clock_out", () => {
    const existingCards: PresenceEmployeeCard[] = [];

    const allEvents: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_out",
        effective_at: "2026-01-15T16:00:00Z",
      }),
    ];

    const profilesMap = new Map([["u1", "Test"]]);

    const merged = mergeBadgeOnlyUsers(existingCards, allEvents, profilesMap);

    expect(merged[0].sessions[0].status).toBe("unknown");
  });

  it("uses 'Inconnu' when user is not in profilesMap", () => {
    const existingCards: PresenceEmployeeCard[] = [];

    const allEvents: BadgeEvent[] = [
      makeEvent({ user_id: "unknown-user", event_type: "clock_in" }),
    ];

    const profilesMap = new Map<string, string>(); // empty

    const merged = mergeBadgeOnlyUsers(existingCards, allEvents, profilesMap);

    expect(merged[0].fullName).toBe("Inconnu");
  });

  it("picks earliest clock_in and latest clock_out for badge-only user with multiple events", () => {
    const existingCards: PresenceEmployeeCard[] = [];

    const allEvents: BadgeEvent[] = [
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        effective_at: "2026-01-15T08:00:00Z", // 09:00 Paris
      }),
      makeEvent({
        user_id: "u1",
        event_type: "clock_in",
        effective_at: "2026-01-15T07:30:00Z", // 08:30 Paris — earlier
      }),
      makeEvent({
        user_id: "u1",
        event_type: "clock_out",
        effective_at: "2026-01-15T16:00:00Z", // 17:00 Paris
      }),
      makeEvent({
        user_id: "u1",
        event_type: "clock_out",
        effective_at: "2026-01-15T17:00:00Z", // 18:00 Paris — later
      }),
    ];

    const profilesMap = new Map([["u1", "Multi Badge"]]);

    const merged = mergeBadgeOnlyUsers(existingCards, allEvents, profilesMap);

    expect(merged).toHaveLength(1);
    const session = merged[0].sessions[0];
    // Earliest clock_in: 07:30 UTC = 08:30 Paris
    expect(session.clockIn).toBe("08:30");
    // Latest clock_out: 17:00 UTC = 18:00 Paris
    expect(session.clockOut).toBe("18:00");
  });

  it("returns empty array when no existing cards and no badge events", () => {
    const merged = mergeBadgeOnlyUsers([], [], new Map());
    expect(merged).toEqual([]);
  });

  it("sets totalLateMinutes and cumulativeLateMinutes to 0 for badge-only users", () => {
    const existingCards: PresenceEmployeeCard[] = [];

    const allEvents: BadgeEvent[] = [makeEvent({ user_id: "u1", event_type: "clock_in" })];

    const profilesMap = new Map([["u1", "Test"]]);

    const merged = mergeBadgeOnlyUsers(existingCards, allEvents, profilesMap);

    expect(merged[0].totalLateMinutes).toBe(0);
    expect(merged[0].cumulativeLateMinutes).toBe(0);
  });

  it("sorts badge-only users alphabetically", () => {
    const existingCards: PresenceEmployeeCard[] = [];

    const allEvents: BadgeEvent[] = [
      makeEvent({ user_id: "u1", event_type: "clock_in" }),
      makeEvent({ user_id: "u2", event_type: "clock_in" }),
    ];

    const profilesMap = new Map([
      ["u1", "Zoey"],
      ["u2", "Alice"],
    ]);

    const merged = mergeBadgeOnlyUsers(existingCards, allEvents, profilesMap);

    expect(merged[0].fullName).toBe("Alice");
    expect(merged[1].fullName).toBe("Zoey");
  });
});
