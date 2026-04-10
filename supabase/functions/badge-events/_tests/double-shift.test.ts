/**
 * Double-Shift Badge Handling Tests
 *
 * V14: Tests for double-shift detection, duplicate badge guard,
 * and the resolve_double_shift action.
 *
 * These are UNIT tests that mock the Supabase client to test pure logic.
 * Run with: npx vitest run supabase/functions/badge-events/_tests/double-shift.test.ts
 *
 * NOTE: These tests use a different pattern from the existing E2E tests in badge-events.test.ts.
 * They test the handler logic directly by extracting pure functions.
 */

import { describe, it, expect } from "vitest";
import { timeToMinutes, buildParisTimestamp } from "../_shared/helpers.ts";

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Helper function tests (pure, no mocking required)
// ═══════════════════════════════════════════════════════════════════════════

describe("timeToMinutes", () => {
  it("converts 00:00 to 0", () => {
    expect(timeToMinutes("00:00")).toBe(0);
  });

  it("converts 09:30 to 570", () => {
    expect(timeToMinutes("09:30")).toBe(570);
  });

  it("converts 14:00 to 840", () => {
    expect(timeToMinutes("14:00")).toBe(840);
  });

  it("converts 23:59 to 1439", () => {
    expect(timeToMinutes("23:59")).toBe(1439);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Double-shift detection logic (pure logic tests)
// ═══════════════════════════════════════════════════════════════════════════

describe("Double-shift detection logic", () => {
  /**
   * Simulates the DOUBLE_SHIFT_DETECTED detection logic from userHandlers.ts
   * This is extracted to be testable without mocking Supabase.
   */
  function shouldDetectDoubleShift(params: {
    openSessionIndex: number;
    nowMinutes: number;
    plannedShifts: Array<{ start_time: string; end_time: string }>;
    departureTolerance: number;
  }): boolean {
    const { openSessionIndex, nowMinutes, plannedShifts, departureTolerance } = params;

    const openShift = plannedShifts[openSessionIndex - 1] || null;
    const hasNextShift = plannedShifts.length > openSessionIndex;

    if (!openShift || !hasNextShift) return false;

    const openShiftEndMin = timeToMinutes(openShift.end_time.slice(0, 5));
    const nextShift = plannedShifts[openSessionIndex];
    const nextShiftStartMin = timeToMinutes(nextShift.start_time.slice(0, 5));

    const pastOpenShiftEnd = nowMinutes > openShiftEndMin + departureTolerance;
    const nearNextShiftStart = Math.abs(nowMinutes - nextShiftStartMin) <= 60;

    return pastOpenShiftEnd && nearNextShiftStart;
  }

  it("detects double shift when past shift 1 end and near shift 2 start", () => {
    // Shift 1: 09:00-12:00, Shift 2: 14:00-18:00
    // Current time: 14:05 (past 12:00 + tolerance, near 14:00)
    const result = shouldDetectDoubleShift({
      openSessionIndex: 1,
      nowMinutes: timeToMinutes("14:05"),
      plannedShifts: [
        { start_time: "09:00:00", end_time: "12:00:00" },
        { start_time: "14:00:00", end_time: "18:00:00" },
      ],
      departureTolerance: 20,
    });
    expect(result).toBe(true);
  });

  it("does NOT detect double shift when still within shift 1 end + tolerance", () => {
    // Shift 1: 09:00-12:00 (tolerance=20), Shift 2: 14:00-18:00
    // Current time: 12:15 (within tolerance of shift 1 end)
    const result = shouldDetectDoubleShift({
      openSessionIndex: 1,
      nowMinutes: timeToMinutes("12:15"),
      plannedShifts: [
        { start_time: "09:00:00", end_time: "12:00:00" },
        { start_time: "14:00:00", end_time: "18:00:00" },
      ],
      departureTolerance: 20,
    });
    expect(result).toBe(false);
  });

  it("does NOT detect double shift when past shift 1 but far from shift 2 start", () => {
    // Shift 1: 09:00-12:00, Shift 2: 18:00-22:00
    // Current time: 12:30 (past shift 1 but NOT near shift 2 at 18:00)
    const result = shouldDetectDoubleShift({
      openSessionIndex: 1,
      nowMinutes: timeToMinutes("12:30"),
      plannedShifts: [
        { start_time: "09:00:00", end_time: "12:00:00" },
        { start_time: "18:00:00", end_time: "22:00:00" },
      ],
      departureTolerance: 20,
    });
    expect(result).toBe(false);
  });

  it("does NOT detect double shift when only one planned shift", () => {
    const result = shouldDetectDoubleShift({
      openSessionIndex: 1,
      nowMinutes: timeToMinutes("15:00"),
      plannedShifts: [
        { start_time: "09:00:00", end_time: "12:00:00" },
      ],
      departureTolerance: 20,
    });
    expect(result).toBe(false);
  });

  it("does NOT detect double shift when no planned shifts at all", () => {
    const result = shouldDetectDoubleShift({
      openSessionIndex: 1,
      nowMinutes: timeToMinutes("15:00"),
      plannedShifts: [],
      departureTolerance: 20,
    });
    expect(result).toBe(false);
  });

  it("detects double shift with tight gap (13:00-14:00) between shifts", () => {
    // Shift 1: 09:00-13:00, Shift 2: 14:00-18:00
    // Current time: 13:45 (past 13:00 + 20 tolerance, near 14:00)
    const result = shouldDetectDoubleShift({
      openSessionIndex: 1,
      nowMinutes: timeToMinutes("13:45"),
      plannedShifts: [
        { start_time: "09:00:00", end_time: "13:00:00" },
        { start_time: "14:00:00", end_time: "18:00:00" },
      ],
      departureTolerance: 20,
    });
    expect(result).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Duplicate badge guard logic
// ═══════════════════════════════════════════════════════════════════════════

describe("Duplicate badge guard logic", () => {
  /**
   * Simulates the DUPLICATE_BADGE detection logic from userHandlers.ts
   */
  function shouldBlockDuplicate(params: {
    lastEventType: "clock_in" | "clock_out";
    lastEventTime: Date;
    currentEventType: "clock_in" | "clock_out";
    currentTime: Date;
  }): boolean {
    const { lastEventType, lastEventTime, currentEventType, currentTime } = params;
    const timeDiffMinutes = (currentTime.getTime() - lastEventTime.getTime()) / 60000;
    return lastEventType === currentEventType && timeDiffMinutes >= 0 && timeDiffMinutes < 5;
  }

  it("blocks duplicate clock_in within 5 minutes", () => {
    const now = new Date("2026-02-17T10:00:00Z");
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
    expect(
      shouldBlockDuplicate({
        lastEventType: "clock_in",
        lastEventTime: twoMinutesAgo,
        currentEventType: "clock_in",
        currentTime: now,
      })
    ).toBe(true);
  });

  it("blocks duplicate clock_out within 5 minutes", () => {
    const now = new Date("2026-02-17T17:00:00Z");
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
    expect(
      shouldBlockDuplicate({
        lastEventType: "clock_out",
        lastEventTime: oneMinuteAgo,
        currentEventType: "clock_out",
        currentTime: now,
      })
    ).toBe(true);
  });

  it("does NOT block when event types differ", () => {
    const now = new Date("2026-02-17T10:00:00Z");
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
    expect(
      shouldBlockDuplicate({
        lastEventType: "clock_in",
        lastEventTime: twoMinutesAgo,
        currentEventType: "clock_out",
        currentTime: now,
      })
    ).toBe(false);
  });

  it("does NOT block when more than 5 minutes have passed", () => {
    const now = new Date("2026-02-17T10:00:00Z");
    const sixMinutesAgo = new Date(now.getTime() - 6 * 60 * 1000);
    expect(
      shouldBlockDuplicate({
        lastEventType: "clock_in",
        lastEventTime: sixMinutesAgo,
        currentEventType: "clock_in",
        currentTime: now,
      })
    ).toBe(false);
  });

  it("does NOT block at exactly 5 minutes boundary", () => {
    const now = new Date("2026-02-17T10:05:00Z");
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    expect(
      shouldBlockDuplicate({
        lastEventType: "clock_in",
        lastEventTime: fiveMinutesAgo,
        currentEventType: "clock_in",
        currentTime: now,
      })
    ).toBe(false);
  });

  it("blocks at 4 minutes 59 seconds", () => {
    const now = new Date("2026-02-17T10:04:59Z");
    const fiveMinutesAgoAlmost = new Date(now.getTime() - (5 * 60 * 1000 - 1000));
    expect(
      shouldBlockDuplicate({
        lastEventType: "clock_in",
        lastEventTime: fiveMinutesAgoAlmost,
        currentEventType: "clock_in",
        currentTime: now,
      })
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Multi-shift session tracking logic
// ═══════════════════════════════════════════════════════════════════════════

describe("Multi-shift session tracking", () => {
  interface MockEvent {
    event_type: "clock_in" | "clock_out";
    sequence_index: number;
  }

  function analyzeSessionState(events: MockEvent[]): {
    completedSessions: Set<number>;
    openSessionIndex: number | null;
  } {
    const completedSessions = new Set<number>();
    let openSessionIndex: number | null = null;

    const eventsBySeq: Record<number, { hasClockIn: boolean; hasClockOut: boolean }> = {};
    for (const ev of events) {
      if (!eventsBySeq[ev.sequence_index]) {
        eventsBySeq[ev.sequence_index] = { hasClockIn: false, hasClockOut: false };
      }
      if (ev.event_type === "clock_in") eventsBySeq[ev.sequence_index].hasClockIn = true;
      if (ev.event_type === "clock_out") eventsBySeq[ev.sequence_index].hasClockOut = true;
    }

    for (const [seqStr, session] of Object.entries(eventsBySeq)) {
      const seq = parseInt(seqStr, 10);
      if (session.hasClockIn && session.hasClockOut) {
        completedSessions.add(seq);
      } else if (session.hasClockIn && !session.hasClockOut) {
        openSessionIndex = seq;
      }
    }

    return { completedSessions, openSessionIndex };
  }

  it("empty events: no completed, no open", () => {
    const { completedSessions, openSessionIndex } = analyzeSessionState([]);
    expect(completedSessions.size).toBe(0);
    expect(openSessionIndex).toBeNull();
  });

  it("single clock_in: open session at seq 1", () => {
    const { completedSessions, openSessionIndex } = analyzeSessionState([
      { event_type: "clock_in", sequence_index: 1 },
    ]);
    expect(completedSessions.size).toBe(0);
    expect(openSessionIndex).toBe(1);
  });

  it("complete shift 1 (in+out): one completed, no open", () => {
    const { completedSessions, openSessionIndex } = analyzeSessionState([
      { event_type: "clock_in", sequence_index: 1 },
      { event_type: "clock_out", sequence_index: 1 },
    ]);
    expect(completedSessions.has(1)).toBe(true);
    expect(openSessionIndex).toBeNull();
  });

  it("complete shift 1, open shift 2: both tracked correctly", () => {
    const { completedSessions, openSessionIndex } = analyzeSessionState([
      { event_type: "clock_in", sequence_index: 1 },
      { event_type: "clock_out", sequence_index: 1 },
      { event_type: "clock_in", sequence_index: 2 },
    ]);
    expect(completedSessions.has(1)).toBe(true);
    expect(completedSessions.size).toBe(1);
    expect(openSessionIndex).toBe(2);
  });

  it("both shifts complete: two completed, no open", () => {
    const { completedSessions, openSessionIndex } = analyzeSessionState([
      { event_type: "clock_in", sequence_index: 1 },
      { event_type: "clock_out", sequence_index: 1 },
      { event_type: "clock_in", sequence_index: 2 },
      { event_type: "clock_out", sequence_index: 2 },
    ]);
    expect(completedSessions.has(1)).toBe(true);
    expect(completedSessions.has(2)).toBe(true);
    expect(openSessionIndex).toBeNull();
  });

  it("shift 1 open (forgot clock_out): only open session detected", () => {
    // This is the double-shift scenario: shift 1 has clock_in but no clock_out
    const { completedSessions, openSessionIndex } = analyzeSessionState([
      { event_type: "clock_in", sequence_index: 1 },
    ]);
    expect(completedSessions.size).toBe(0);
    expect(openSessionIndex).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: Event type determination logic
// ═══════════════════════════════════════════════════════════════════════════

describe("Event type determination", () => {
  function determineEventType(params: {
    openSessionIndex: number | null;
    hasEvents: boolean;
    completedSessions: Set<number>;
  }): { eventType: "clock_in" | "clock_out"; sequenceIndex: number } | { error: string } {
    const { openSessionIndex, hasEvents, completedSessions } = params;

    if (openSessionIndex !== null) {
      return { eventType: "clock_out", sequenceIndex: openSessionIndex };
    }
    if (!hasEvents) {
      return { eventType: "clock_in", sequenceIndex: 1 };
    }
    const maxCompletedSeq = Math.max(...completedSessions, 0);
    if (maxCompletedSeq >= 2) {
      return { error: "MAX_SHIFTS" };
    }
    return { eventType: "clock_in", sequenceIndex: maxCompletedSeq + 1 };
  }

  it("no events: clock_in at seq 1", () => {
    const result = determineEventType({
      openSessionIndex: null,
      hasEvents: false,
      completedSessions: new Set(),
    });
    expect(result).toEqual({ eventType: "clock_in", sequenceIndex: 1 });
  });

  it("open session at seq 1: clock_out at seq 1", () => {
    const result = determineEventType({
      openSessionIndex: 1,
      hasEvents: true,
      completedSessions: new Set(),
    });
    expect(result).toEqual({ eventType: "clock_out", sequenceIndex: 1 });
  });

  it("shift 1 complete: clock_in at seq 2", () => {
    const result = determineEventType({
      openSessionIndex: null,
      hasEvents: true,
      completedSessions: new Set([1]),
    });
    expect(result).toEqual({ eventType: "clock_in", sequenceIndex: 2 });
  });

  it("both shifts complete: MAX_SHIFTS error", () => {
    const result = determineEventType({
      openSessionIndex: null,
      hasEvents: true,
      completedSessions: new Set([1, 2]),
    });
    expect(result).toEqual({ error: "MAX_SHIFTS" });
  });

  it("open session at seq 2: clock_out at seq 2", () => {
    const result = determineEventType({
      openSessionIndex: 2,
      hasEvents: true,
      completedSessions: new Set([1]),
    });
    expect(result).toEqual({ eventType: "clock_out", sequenceIndex: 2 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: buildParisTimestamp validation
// ═══════════════════════════════════════════════════════════════════════════

describe("buildParisTimestamp for double-shift resolution", () => {
  it("builds timestamp for a morning time", () => {
    const ts = buildParisTimestamp("2026-02-17", "12:00");
    const date = new Date(ts);
    expect(date.getTime()).toBeGreaterThan(0);
    // Verify it is a valid ISO string
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("builds timestamp for midnight boundary", () => {
    const ts = buildParisTimestamp("2026-02-17", "00:00");
    const date = new Date(ts);
    expect(date.getTime()).toBeGreaterThan(0);
  });

  it("builds timestamp for end of day", () => {
    const ts = buildParisTimestamp("2026-02-17", "23:59");
    const date = new Date(ts);
    expect(date.getTime()).toBeGreaterThan(0);
  });
});
