/**
 * Tests for computeEffectiveTime.ts — Effective time computation
 *
 * PRD rules:
 * CLOCK_IN:
 * - Early arrival -> effective = planned_start
 * - Late within tolerance -> effective = planned_start
 * - Late beyond tolerance -> effective = occurred (real lateness)
 *
 * CLOCK_OUT:
 * - After end within tolerance -> effective = planned_end
 * - After end beyond tolerance -> effective = occurred (extra suspected)
 * - Before planned_end -> handled elsewhere (SHIFT_NOT_FINISHED guard)
 */

import { describe, it, expect } from "vitest";
import { computeEffectiveTime, minutesToTime, formatBadgeTime } from "../computeEffectiveTime";

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Create a Date at specific UTC time (winter CET = UTC+1)
// ─────────────────────────────────────────────────────────────────────────────

function makeUTCDate(hours: number, minutes: number): Date {
  return new Date(
    `2026-01-15T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00Z`
  );
}

const defaultSettings = {
  arrival_tolerance_min: 5,
  departure_tolerance_min: 5,
};

// ═══════════════════════════════════════════════════════════════════════════════
// minutesToTime
// ═══════════════════════════════════════════════════════════════════════════════

describe("minutesToTime", () => {
  it("converts 0 minutes to 00:00", () => {
    expect(minutesToTime(0)).toBe("00:00");
  });

  it("converts 60 minutes to 01:00", () => {
    expect(minutesToTime(60)).toBe("01:00");
  });

  it("converts 90 minutes to 01:30", () => {
    expect(minutesToTime(90)).toBe("01:30");
  });

  it("converts 1439 minutes to 23:59", () => {
    expect(minutesToTime(1439)).toBe("23:59");
  });

  it("wraps around 1440 minutes to 00:00 (mod 24)", () => {
    expect(minutesToTime(1440)).toBe("00:00");
  });

  it("converts 720 minutes to 12:00", () => {
    expect(minutesToTime(720)).toBe("12:00");
  });

  it("pads single-digit hours and minutes", () => {
    expect(minutesToTime(5)).toBe("00:05");
    expect(minutesToTime(65)).toBe("01:05");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// computeEffectiveTime — CLOCK_IN
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeEffectiveTime — clock_in", () => {
  const shift = { start_time: "09:00", end_time: "17:00" };

  it("returns planned_start when employee arrives early", () => {
    // 07:30 UTC = 08:30 Paris, planned start 09:00
    const result = computeEffectiveTime(makeUTCDate(7, 30), "clock_in", shift, defaultSettings);
    expect(result).toBe("09:00");
  });

  it("returns planned_start when employee arrives exactly on time", () => {
    // 08:00 UTC = 09:00 Paris, planned start 09:00
    const result = computeEffectiveTime(makeUTCDate(8, 0), "clock_in", shift, defaultSettings);
    expect(result).toBe("09:00");
  });

  it("returns planned_start when late within tolerance (3 min)", () => {
    // 08:03 UTC = 09:03 Paris, planned 09:00, tolerance 5 min
    const result = computeEffectiveTime(makeUTCDate(8, 3), "clock_in", shift, defaultSettings);
    expect(result).toBe("09:00");
  });

  it("returns planned_start when late exactly at tolerance boundary (5 min)", () => {
    // 08:05 UTC = 09:05 Paris, planned 09:00, tolerance 5 min
    const result = computeEffectiveTime(makeUTCDate(8, 5), "clock_in", shift, defaultSettings);
    expect(result).toBe("09:00");
  });

  it("returns occurred time when late beyond tolerance (6 min)", () => {
    // 08:06 UTC = 09:06 Paris, planned 09:00, tolerance 5 min
    const result = computeEffectiveTime(makeUTCDate(8, 6), "clock_in", shift, defaultSettings);
    expect(result).toBe("09:06");
  });

  it("returns occurred time when very late (1 hour)", () => {
    // 09:00 UTC = 10:00 Paris, planned 09:00
    const result = computeEffectiveTime(makeUTCDate(9, 0), "clock_in", shift, defaultSettings);
    expect(result).toBe("10:00");
  });

  it("returns occurred time when no planned shift", () => {
    // No shift -> just return occurred time
    const result = computeEffectiveTime(makeUTCDate(8, 15), "clock_in", null, defaultSettings);
    expect(result).toBe("09:15"); // 08:15 UTC = 09:15 Paris
  });

  it("handles zero tolerance (any late = actual time)", () => {
    const zeroTolerance = { arrival_tolerance_min: 0, departure_tolerance_min: 0 };
    // 08:01 UTC = 09:01 Paris, 1 min late with 0 tolerance
    const result = computeEffectiveTime(makeUTCDate(8, 1), "clock_in", shift, zeroTolerance);
    expect(result).toBe("09:01");
  });

  it("handles large tolerance (15 min)", () => {
    const largeTolerance = { arrival_tolerance_min: 15, departure_tolerance_min: 5 };
    // 08:14 UTC = 09:14 Paris, 14 min late within 15 min tolerance
    const result = computeEffectiveTime(makeUTCDate(8, 14), "clock_in", shift, largeTolerance);
    expect(result).toBe("09:00");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// computeEffectiveTime — CLOCK_OUT
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeEffectiveTime — clock_out", () => {
  const shift = { start_time: "09:00", end_time: "17:00" };

  it("returns planned_end when employee leaves exactly on time", () => {
    // 16:00 UTC = 17:00 Paris, planned end 17:00
    const result = computeEffectiveTime(makeUTCDate(16, 0), "clock_out", shift, defaultSettings);
    expect(result).toBe("17:00");
  });

  it("returns planned_end when leaving within tolerance (3 min after)", () => {
    // 16:03 UTC = 17:03 Paris, planned end 17:00, tolerance 5 min
    const result = computeEffectiveTime(makeUTCDate(16, 3), "clock_out", shift, defaultSettings);
    expect(result).toBe("17:00");
  });

  it("returns planned_end when leaving at exact tolerance boundary (5 min)", () => {
    // 16:05 UTC = 17:05 Paris, planned end 17:00, tolerance 5 min
    const result = computeEffectiveTime(makeUTCDate(16, 5), "clock_out", shift, defaultSettings);
    expect(result).toBe("17:00");
  });

  it("returns occurred time when leaving very late (extra suspected)", () => {
    // 16:06 UTC = 17:06 Paris, planned end 17:00, tolerance 5 min
    const result = computeEffectiveTime(makeUTCDate(16, 6), "clock_out", shift, defaultSettings);
    expect(result).toBe("17:06");
  });

  it("returns occurred time when leaving 1 hour late (overtime)", () => {
    // 17:00 UTC = 18:00 Paris, planned end 17:00
    const result = computeEffectiveTime(makeUTCDate(17, 0), "clock_out", shift, defaultSettings);
    expect(result).toBe("18:00");
  });

  it("returns occurred time when leaving early (before planned end)", () => {
    // 15:00 UTC = 16:00 Paris, planned end 17:00 -> left 1h early
    // lateMinutes = 16:00 - 17:00 = -60, which is < 0
    const result = computeEffectiveTime(makeUTCDate(15, 0), "clock_out", shift, defaultSettings);
    // Since lateMinutes is negative, condition `lateMinutes >= 0` is false
    // Falls to the else branch -> returns occurred time
    expect(result).toBe("16:00");
  });

  it("returns occurred time when no planned shift", () => {
    const result = computeEffectiveTime(makeUTCDate(16, 30), "clock_out", null, defaultSettings);
    expect(result).toBe("17:30");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatBadgeTime
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatBadgeTime", () => {
  it("returns --:-- for null", () => {
    expect(formatBadgeTime(null)).toBe("--:--");
  });

  it("returns --:-- for undefined", () => {
    expect(formatBadgeTime(undefined)).toBe("--:--");
  });

  it("returns --:-- for empty string", () => {
    expect(formatBadgeTime("")).toBe("--:--");
  });

  it("formats a UTC ISO string to Paris time", () => {
    // 08:00 UTC = 09:00 Paris CET
    expect(formatBadgeTime("2026-01-15T08:00:00Z")).toBe("09:00");
  });

  it("formats a summer time ISO string to Paris time", () => {
    // 08:00 UTC = 10:00 Paris CEST
    expect(formatBadgeTime("2026-07-15T08:00:00Z")).toBe("10:00");
  });
});
