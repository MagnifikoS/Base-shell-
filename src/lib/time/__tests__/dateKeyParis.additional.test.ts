/**
 * Additional tests for dateKeyParis.ts — Extended coverage
 *
 * Supplements the existing dateKeyParis.test.ts with:
 * - getMonthBoundsParis edge cases
 * - addDaysToDateKey edge cases (year boundaries, leap years)
 * - toYearMonthParis
 * - getYearMonthFromDateParis
 * - getTodayDateKeyParis format validation
 * - formatParisDateKey edge cases
 */

import { describe, it, expect } from "vitest";
import {
  formatParisDateKey,
  getMonthStartDateKeyParis,
  getMonthEndDateKeyParis,
  getMonthBoundsParis,
  addDaysToDateKey,
  getTodayDateKeyParis,
  toYearMonthParis,
  getYearMonthFromDateParis,
} from "../dateKeyParis";

// ═══════════════════════════════════════════════════════════════════════════════
// getMonthBoundsParis — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("getMonthBoundsParis — additional edge cases", () => {
  it("returns correct bounds for February in leap year (2024)", () => {
    const { start, end } = getMonthBoundsParis("2024-02");
    expect(start).toBe("2024-02-01");
    expect(end).toBe("2024-02-29");
  });

  it("returns correct bounds for February in non-leap year (2026)", () => {
    const { start, end } = getMonthBoundsParis("2026-02");
    expect(start).toBe("2026-02-01");
    expect(end).toBe("2026-02-28");
  });

  it("returns correct bounds for December (year-end)", () => {
    const { start, end } = getMonthBoundsParis("2026-12");
    expect(start).toBe("2026-12-01");
    expect(end).toBe("2026-12-31");
  });

  it("returns correct bounds for April (30 days)", () => {
    const { start, end } = getMonthBoundsParis("2026-04");
    expect(start).toBe("2026-04-01");
    expect(end).toBe("2026-04-30");
  });

  it("returns correct bounds for June (30 days)", () => {
    const { start, end } = getMonthBoundsParis("2026-06");
    expect(start).toBe("2026-06-01");
    expect(end).toBe("2026-06-30");
  });

  it("returns correct bounds for March (31 days)", () => {
    const { start, end } = getMonthBoundsParis("2026-03");
    expect(start).toBe("2026-03-01");
    expect(end).toBe("2026-03-31");
  });

  it("returns correct bounds for November (30 days)", () => {
    const { start, end } = getMonthBoundsParis("2026-11");
    expect(start).toBe("2026-11-01");
    expect(end).toBe("2026-11-30");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// addDaysToDateKey — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("addDaysToDateKey — additional edge cases", () => {
  it("adds 0 days (no change)", () => {
    expect(addDaysToDateKey("2026-01-15", 0)).toBe("2026-01-15");
  });

  it("handles year boundary (Dec 31 + 1 = Jan 1 next year)", () => {
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles year boundary backward (Jan 1 - 1 = Dec 31 previous year)", () => {
    expect(addDaysToDateKey("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles leap year day (Feb 28 + 1 in leap year = Feb 29)", () => {
    expect(addDaysToDateKey("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("handles leap year to March (Feb 29 + 1 = Mar 1)", () => {
    expect(addDaysToDateKey("2024-02-29", 1)).toBe("2024-03-01");
  });

  it("handles non-leap year Feb 28 + 1 = Mar 1", () => {
    expect(addDaysToDateKey("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("adds 7 days (one week)", () => {
    expect(addDaysToDateKey("2026-01-08", 7)).toBe("2026-01-15");
  });

  it("subtracts 7 days (one week back)", () => {
    expect(addDaysToDateKey("2026-01-15", -7)).toBe("2026-01-08");
  });

  it("adds 30 days across month boundary", () => {
    expect(addDaysToDateKey("2026-01-15", 30)).toBe("2026-02-14");
  });

  it("adds 365 days (full year)", () => {
    expect(addDaysToDateKey("2026-01-01", 365)).toBe("2027-01-01");
  });

  it("handles negative large delta", () => {
    expect(addDaysToDateKey("2026-06-15", -180)).toBe("2025-12-17");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// toYearMonthParis — tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("toYearMonthParis", () => {
  it("extracts YYYY-MM from standard date string", () => {
    expect(toYearMonthParis("2026-01-15")).toBe("2026-01");
  });

  it("extracts YYYY-MM from last day of month", () => {
    expect(toYearMonthParis("2026-01-31")).toBe("2026-01");
  });

  it("extracts YYYY-MM from first day of month", () => {
    expect(toYearMonthParis("2026-12-01")).toBe("2026-12");
  });

  it("handles December correctly (month 12)", () => {
    expect(toYearMonthParis("2026-12-25")).toBe("2026-12");
  });

  it("handles January correctly (month 01)", () => {
    expect(toYearMonthParis("2026-01-01")).toBe("2026-01");
  });

  it("handles February in leap year", () => {
    expect(toYearMonthParis("2024-02-29")).toBe("2024-02");
  });

  it("pads single-digit months", () => {
    expect(toYearMonthParis("2026-03-15")).toBe("2026-03");
  });

  it("handles invalid date string by returning fallback (current month)", () => {
    const result = toYearMonthParis("invalid-date");
    // Should be a valid YYYY-MM format
    expect(result).toMatch(/^\d{4}-\d{2}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getYearMonthFromDateParis — tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("getYearMonthFromDateParis", () => {
  it("extracts YYYY-MM from Date object in winter (CET)", () => {
    // 2026-01-15 at noon UTC -> 13:00 Paris CET -> still Jan 15
    const date = new Date("2026-01-15T12:00:00Z");
    expect(getYearMonthFromDateParis(date)).toBe("2026-01");
  });

  it("extracts YYYY-MM from Date object in summer (CEST)", () => {
    const date = new Date("2026-07-15T12:00:00Z");
    expect(getYearMonthFromDateParis(date)).toBe("2026-07");
  });

  it("handles midnight crossing at year boundary", () => {
    // 2026-12-31T23:30:00Z = 2027-01-01 00:30 Paris CET
    const date = new Date("2026-12-31T23:30:00Z");
    expect(getYearMonthFromDateParis(date)).toBe("2027-01");
  });

  it("handles midnight crossing at month boundary", () => {
    // 2026-01-31T23:30:00Z = 2026-02-01 00:30 Paris CET
    const date = new Date("2026-01-31T23:30:00Z");
    expect(getYearMonthFromDateParis(date)).toBe("2026-02");
  });

  it("handles Date at exact midnight UTC in February", () => {
    // 2026-02-01T00:00:00Z = 2026-02-01 01:00 Paris CET
    const date = new Date("2026-02-01T00:00:00Z");
    expect(getYearMonthFromDateParis(date)).toBe("2026-02");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getTodayDateKeyParis — format validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("getTodayDateKeyParis", () => {
  it("returns a YYYY-MM-DD formatted string", () => {
    const today = getTodayDateKeyParis();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns a string of length 10", () => {
    expect(getTodayDateKeyParis().length).toBe(10);
  });

  it("year part is a valid 4-digit year", () => {
    const year = parseInt(getTodayDateKeyParis().slice(0, 4), 10);
    expect(year).toBeGreaterThanOrEqual(2020);
    expect(year).toBeLessThanOrEqual(2030);
  });

  it("month part is between 01 and 12", () => {
    const month = parseInt(getTodayDateKeyParis().slice(5, 7), 10);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
  });

  it("day part is between 01 and 31", () => {
    const day = parseInt(getTodayDateKeyParis().slice(8, 10), 10);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatParisDateKey — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatParisDateKey — additional edge cases", () => {
  it("handles summer date correctly", () => {
    // 2026-07-15 at noon local time
    const date = new Date(2026, 6, 15, 12, 0, 0);
    expect(formatParisDateKey(date)).toBe("2026-07-15");
  });

  it("handles December 31 near midnight", () => {
    const date = new Date(2026, 11, 31, 23, 59, 59);
    expect(formatParisDateKey(date)).toBe("2026-12-31");
  });

  it("handles January 1 at midnight", () => {
    const date = new Date(2026, 0, 1, 0, 0, 0);
    expect(formatParisDateKey(date)).toBe("2026-01-01");
  });

  it("handles February 29 in leap year", () => {
    const date = new Date(2024, 1, 29, 12, 0, 0);
    expect(formatParisDateKey(date)).toBe("2024-02-29");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getMonthStartDateKeyParis / getMonthEndDateKeyParis — additional
// ═══════════════════════════════════════════════════════════════════════════════

describe("getMonthStartDateKeyParis — additional", () => {
  it("handles all 12 months", () => {
    for (let m = 0; m < 12; m++) {
      const result = getMonthStartDateKeyParis(2026, m);
      expect(result).toBe(`2026-${String(m + 1).padStart(2, "0")}-01`);
    }
  });
});

describe("getMonthEndDateKeyParis — additional", () => {
  it("handles all 12 months for 2026 (non-leap year)", () => {
    const expectedLastDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let m = 0; m < 12; m++) {
      const result = getMonthEndDateKeyParis(2026, m);
      const expectedDay = String(expectedLastDays[m]).padStart(2, "0");
      expect(result).toBe(`2026-${String(m + 1).padStart(2, "0")}-${expectedDay}`);
    }
  });

  it("handles all 12 months for 2024 (leap year)", () => {
    const expectedLastDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let m = 0; m < 12; m++) {
      const result = getMonthEndDateKeyParis(2024, m);
      const expectedDay = String(expectedLastDays[m]).padStart(2, "0");
      expect(result).toBe(`2024-${String(m + 1).padStart(2, "0")}-${expectedDay}`);
    }
  });
});
