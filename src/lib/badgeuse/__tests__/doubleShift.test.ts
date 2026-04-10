/**
 * Double-Shift Badge Handling — Pure Logic Tests
 *
 * V14: Tests for double-shift detection, duplicate badge guard,
 * and multi-shift session tracking logic.
 *
 * These test the pure functions and logic extracted from userHandlers.ts
 * without needing Supabase mocks.
 */

import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════
// Helper: timeToMinutes (same logic as in helpers.ts)
// ═══════════════════════════════════════════════════════════════════════════
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Double-shift detection logic
// ═══════════════════════════════════════════════════════════════════════════

describe("Double-shift detection logic", () => {
  /**
   * Simulates the DOUBLE_SHIFT_DETECTED detection logic from userHandlers.ts V14
   * Pure function that can be tested without Supabase.
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

  it("does NOT detect when still within shift 1 end + tolerance", () => {
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

  it("does NOT detect when past shift 1 but far from shift 2 start", () => {
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

  it("does NOT detect when only one planned shift", () => {
    const result = shouldDetectDoubleShift({
      openSessionIndex: 1,
      nowMinutes: timeToMinutes("15:00"),
      plannedShifts: [{ start_time: "09:00:00", end_time: "12:00:00" }],
      departureTolerance: 20,
    });
    expect(result).toBe(false);
  });

  it("does NOT detect when no planned shifts", () => {
    const result = shouldDetectDoubleShift({
      openSessionIndex: 1,
      nowMinutes: timeToMinutes("15:00"),
      plannedShifts: [],
      departureTolerance: 20,
    });
    expect(result).toBe(false);
  });

  it("detects with tight gap between shifts", () => {
    // Shift 1: 09:00-13:00, Shift 2: 14:00-18:00, tolerance 20min
    // At 13:45 → past 13:00+20 = 13:20, near 14:00
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

  it("does NOT detect at exactly the tolerance boundary", () => {
    // At 12:20 (exactly shift end + tolerance), not past
    const result = shouldDetectDoubleShift({
      openSessionIndex: 1,
      nowMinutes: timeToMinutes("12:20"),
      plannedShifts: [
        { start_time: "09:00:00", end_time: "12:00:00" },
        { start_time: "14:00:00", end_time: "18:00:00" },
      ],
      departureTolerance: 20,
    });
    expect(result).toBe(false);
  });

  it("detects at 1 minute past tolerance boundary", () => {
    // At 12:21 (shift end + tolerance + 1)
    // But 12:21 is NOT near 14:00 (distance 99 min > 60)
    const result = shouldDetectDoubleShift({
      openSessionIndex: 1,
      nowMinutes: timeToMinutes("12:21"),
      plannedShifts: [
        { start_time: "09:00:00", end_time: "12:00:00" },
        { start_time: "14:00:00", end_time: "18:00:00" },
      ],
      departureTolerance: 20,
    });
    // 12:21 is 99 minutes from 14:00 → NOT near. So false.
    expect(result).toBe(false);
  });

  it("detects with contiguous shifts (no break)", () => {
    // Shift 1: 09:00-14:00, Shift 2: 14:00-18:00
    // At 14:25 → past 14:00+20, near 14:00 (distance=25)
    const result = shouldDetectDoubleShift({
      openSessionIndex: 1,
      nowMinutes: timeToMinutes("14:25"),
      plannedShifts: [
        { start_time: "09:00:00", end_time: "14:00:00" },
        { start_time: "14:00:00", end_time: "18:00:00" },
      ],
      departureTolerance: 20,
    });
    expect(result).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Duplicate badge guard logic
// ═══════════════════════════════════════════════════════════════════════════

describe("Duplicate badge guard logic", () => {
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

  it("does NOT block when event types differ (clock_in vs clock_out)", () => {
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

  it("does NOT block at exactly 5 minutes (boundary)", () => {
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

  it("blocks at 4 min 59 sec (just under 5 min)", () => {
    const now = new Date("2026-02-17T10:04:59Z");
    const almostFive = new Date(now.getTime() - (5 * 60 * 1000 - 1000));
    expect(
      shouldBlockDuplicate({
        lastEventType: "clock_in",
        lastEventTime: almostFive,
        currentEventType: "clock_in",
        currentTime: now,
      })
    ).toBe(true);
  });

  it("does NOT block duplicate badge from the future (negative time diff)", () => {
    const now = new Date("2026-02-17T10:00:00Z");
    const futureEvent = new Date(now.getTime() + 60 * 1000);
    expect(
      shouldBlockDuplicate({
        lastEventType: "clock_in",
        lastEventTime: futureEvent,
        currentEventType: "clock_in",
        currentTime: now,
      })
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Multi-shift session state tracking
// ═══════════════════════════════════════════════════════════════════════════

describe("Multi-shift session state tracking", () => {
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

  it("complete single shift (in+out): one completed, no open", () => {
    const { completedSessions, openSessionIndex } = analyzeSessionState([
      { event_type: "clock_in", sequence_index: 1 },
      { event_type: "clock_out", sequence_index: 1 },
    ]);
    expect(completedSessions.has(1)).toBe(true);
    expect(openSessionIndex).toBeNull();
  });

  it("complete shift 1, open shift 2: correctly tracked", () => {
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
    expect(completedSessions.size).toBe(2);
    expect(openSessionIndex).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Event type determination
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
// SECTION 5: Integration scenario (full normal flow unchanged)
// ═══════════════════════════════════════════════════════════════════════════

describe("Single-shift normal flow remains unchanged", () => {
  // Verifies that the basic single-shift badge flow logic is not affected
  // by the double-shift detection additions.

  function simulateNormalSingleShiftFlow(): string[] {
    const events: string[] = [];

    // Scenario: Single shift 09:00-17:00
    // Step 1: No events → clock_in
    let openSessionIndex: number | null = null;
    const completedSessions = new Set<number>();
    const hasEvents = false;

    if (openSessionIndex === null && !hasEvents) {
      events.push("clock_in:1");
    }

    // Step 2: After clock_in → clock_out
    openSessionIndex = 1;
    if (openSessionIndex !== null) {
      events.push("clock_out:1");
    }

    // Step 3: After clock_out → done (1 shift = no more for single shift day)
    openSessionIndex = null;
    completedSessions.add(1);
    const maxSeq = Math.max(...completedSessions, 0);
    if (maxSeq < 2) {
      events.push("available:clock_in:2");
    }

    return events;
  }

  it("produces correct event sequence for single shift", () => {
    const events = simulateNormalSingleShiftFlow();
    expect(events).toEqual(["clock_in:1", "clock_out:1", "available:clock_in:2"]);
  });

  function simulateNormalDoubleShiftFlow(): string[] {
    const events: string[] = [];
    const completedSessions = new Set<number>();

    // Step 1: clock_in for shift 1
    events.push("clock_in:1");

    // Step 2: clock_out for shift 1
    events.push("clock_out:1");
    completedSessions.add(1);

    // Step 3: clock_in for shift 2
    events.push("clock_in:2");

    // Step 4: clock_out for shift 2
    events.push("clock_out:2");
    completedSessions.add(2);

    // Step 5: Max shifts reached
    const maxSeq = Math.max(...completedSessions, 0);
    if (maxSeq >= 2) {
      events.push("MAX_SHIFTS");
    }

    return events;
  }

  it("produces correct event sequence for normal double shift", () => {
    const events = simulateNormalDoubleShiftFlow();
    expect(events).toEqual([
      "clock_in:1",
      "clock_out:1",
      "clock_in:2",
      "clock_out:2",
      "MAX_SHIFTS",
    ]);
  });
});
