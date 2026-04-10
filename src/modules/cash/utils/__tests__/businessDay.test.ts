/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CASH MODULE — Business Day Utils Tests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests the pure date formatting/manipulation functions.
 * NOTE: Service day calculation (cutoff logic) uses backend RPC —
 * only formatting utilities are tested here.
 */

import { describe, it, expect } from "vitest";
import { toSafeMiddayUTC, addDaysSafe, formatBusinessDay } from "../businessDay";

// ═══════════════════════════════════════════════════════════════════════════
// toSafeMiddayUTC
// ═══════════════════════════════════════════════════════════════════════════

describe("toSafeMiddayUTC", () => {
  it("creates a Date at 12:00:00 UTC", () => {
    const result = toSafeMiddayUTC("2026-01-15");
    expect(result.getUTCHours()).toBe(12);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
  });

  it("preserves the correct date", () => {
    const result = toSafeMiddayUTC("2026-06-20");
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(5); // June = month 5
    expect(result.getUTCDate()).toBe(20);
  });

  it("handles January 1st", () => {
    const result = toSafeMiddayUTC("2026-01-01");
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(0);
    expect(result.getUTCDate()).toBe(1);
  });

  it("handles December 31st", () => {
    const result = toSafeMiddayUTC("2026-12-31");
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(11);
    expect(result.getUTCDate()).toBe(31);
  });

  it("handles leap year date (Feb 29)", () => {
    const result = toSafeMiddayUTC("2028-02-29");
    expect(result.getUTCMonth()).toBe(1);
    expect(result.getUTCDate()).toBe(29);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// addDaysSafe
// ═══════════════════════════════════════════════════════════════════════════

describe("addDaysSafe", () => {
  it("adds 1 day", () => {
    expect(addDaysSafe("2026-01-15", 1)).toBe("2026-01-16");
  });

  it("subtracts 1 day", () => {
    expect(addDaysSafe("2026-01-15", -1)).toBe("2026-01-14");
  });

  it("adds 0 days (identity)", () => {
    expect(addDaysSafe("2026-06-20", 0)).toBe("2026-06-20");
  });

  it("crosses month boundary forward", () => {
    expect(addDaysSafe("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("crosses month boundary backward", () => {
    expect(addDaysSafe("2026-02-01", -1)).toBe("2026-01-31");
  });

  it("crosses year boundary forward", () => {
    expect(addDaysSafe("2025-12-31", 1)).toBe("2026-01-01");
  });

  it("crosses year boundary backward", () => {
    expect(addDaysSafe("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles large delta", () => {
    expect(addDaysSafe("2026-01-01", 365)).toBe("2027-01-01");
  });

  it("handles February in non-leap year", () => {
    expect(addDaysSafe("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("handles February in leap year", () => {
    expect(addDaysSafe("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysSafe("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("returns YYYY-MM-DD format with zero-padded month and day", () => {
    const result = addDaysSafe("2026-01-01", 0);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// formatBusinessDay
// ═══════════════════════════════════════════════════════════════════════════

describe("formatBusinessDay", () => {
  it("returns a French locale formatted string", () => {
    const result = formatBusinessDay("2026-01-15");
    // Should contain "janvier" (French for January) and "2026"
    expect(result).toContain("janvier");
    expect(result).toContain("2026");
    expect(result).toContain("15");
  });

  it("includes the day of the week in French", () => {
    // 2026-01-15 is a Thursday
    const result = formatBusinessDay("2026-01-15");
    expect(result).toContain("jeudi");
  });

  it("formats summer dates correctly", () => {
    // 2026-07-04 is a Saturday
    const result = formatBusinessDay("2026-07-04");
    expect(result).toContain("juillet");
    expect(result).toContain("2026");
    expect(result).toContain("samedi");
  });

  it("does not shift date due to timezone issues (midday anchor)", () => {
    // This is the key property: using midday UTC prevents any TZ from shifting the day
    const result = formatBusinessDay("2026-03-01");
    expect(result).toContain("mars");
    expect(result).toContain("1");
    // Should NOT show February (i.e. no timezone shift)
    expect(result).not.toContain("février");
  });
});
