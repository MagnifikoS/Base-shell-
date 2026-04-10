/**
 * Tests for dateKeyParis.ts - Timezone-safe date key generation
 * 
 * Critical bug prevention: ensures last day of month is never truncated
 * due to UTC shift (the bug that caused January 31st to be missed).
 */

import { describe, it, expect } from "vitest";
import {
  formatParisDateKey,
  getMonthStartDateKeyParis,
  getMonthEndDateKeyParis,
  getMonthBoundsParis,
  addDaysToDateKey,
} from "../dateKeyParis";

describe("dateKeyParis", () => {
  describe("getMonthEndDateKeyParis", () => {
    it("returns correct last day for January (31 days, UTC+1)", () => {
      // January 2026 has 31 days
      expect(getMonthEndDateKeyParis(2026, 0)).toBe("2026-01-31");
    });

    it("returns correct last day for July (31 days, UTC+2 summer time)", () => {
      // July 2026 has 31 days, and Paris is UTC+2 in summer
      expect(getMonthEndDateKeyParis(2026, 6)).toBe("2026-07-31");
    });

    it("returns correct last day for February (non-leap year)", () => {
      // 2026 is not a leap year
      expect(getMonthEndDateKeyParis(2026, 1)).toBe("2026-02-28");
    });

    it("returns correct last day for February (leap year)", () => {
      // 2024 is a leap year
      expect(getMonthEndDateKeyParis(2024, 1)).toBe("2024-02-29");
    });

    it("returns correct last day for December", () => {
      expect(getMonthEndDateKeyParis(2026, 11)).toBe("2026-12-31");
    });

    it("returns correct last day for April (30 days)", () => {
      expect(getMonthEndDateKeyParis(2026, 3)).toBe("2026-04-30");
    });
  });

  describe("getMonthStartDateKeyParis", () => {
    it("returns first day for January", () => {
      expect(getMonthStartDateKeyParis(2026, 0)).toBe("2026-01-01");
    });

    it("returns first day for December", () => {
      expect(getMonthStartDateKeyParis(2026, 11)).toBe("2026-12-01");
    });
  });

  describe("getMonthBoundsParis", () => {
    it("returns correct bounds for January 2026", () => {
      const { start, end } = getMonthBoundsParis("2026-01");
      expect(start).toBe("2026-01-01");
      expect(end).toBe("2026-01-31");
    });

    it("returns correct bounds for July 2026 (summer time UTC+2)", () => {
      const { start, end } = getMonthBoundsParis("2026-07");
      expect(start).toBe("2026-07-01");
      expect(end).toBe("2026-07-31");
    });

    it("returns correct bounds for February leap year", () => {
      const { start, end } = getMonthBoundsParis("2024-02");
      expect(start).toBe("2024-02-01");
      expect(end).toBe("2024-02-29");
    });
  });

  describe("formatParisDateKey", () => {
    it("formats a date correctly", () => {
      // Create a specific date
      const date = new Date(2026, 0, 31, 12, 0, 0); // Jan 31, 2026 at noon
      expect(formatParisDateKey(date)).toBe("2026-01-31");
    });

    it("handles midnight correctly without UTC shift", () => {
      // This is the edge case that caused the bug:
      // At midnight Paris time, UTC would be the previous day
      const date = new Date(2026, 0, 31, 0, 0, 0); // Jan 31, 2026 at midnight local
      expect(formatParisDateKey(date)).toBe("2026-01-31");
    });
  });

  describe("addDaysToDateKey", () => {
    it("adds days correctly", () => {
      expect(addDaysToDateKey("2026-01-31", 1)).toBe("2026-02-01");
    });

    it("subtracts days correctly", () => {
      expect(addDaysToDateKey("2026-02-01", -1)).toBe("2026-01-31");
    });

    it("handles month boundaries", () => {
      expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
    });
  });
});
