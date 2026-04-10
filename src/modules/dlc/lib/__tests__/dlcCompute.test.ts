/**
 * DLC V0 — Tests for dlcCompute.ts (SSOT computation logic).
 * Validates: status calculation, days remaining, formatting, sorting.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeDlcStatus,
  computeDlcDaysRemaining,
  formatDlcDate,
  dlcUrgencyComparator,
} from "../dlcCompute";

// Fix "today" to 2026-03-06 for deterministic tests
const FIXED_NOW = new Date("2026-03-06T10:00:00");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("computeDlcStatus", () => {
  it("returns 'expired' when DLC is in the past", () => {
    expect(computeDlcStatus("2026-03-05", null)).toBe("expired");
    expect(computeDlcStatus("2026-03-01", null)).toBe("expired");
  });

  it("returns 'warning' when DLC is today (0 days remaining ≤ threshold)", () => {
    expect(computeDlcStatus("2026-03-06", null)).toBe("warning");
  });

  it("returns 'warning' when DLC is within default threshold (3 days)", () => {
    expect(computeDlcStatus("2026-03-07", null)).toBe("warning"); // 1 day
    expect(computeDlcStatus("2026-03-08", null)).toBe("warning"); // 2 days
    expect(computeDlcStatus("2026-03-09", null)).toBe("warning"); // 3 days
  });

  it("returns 'ok' when DLC is beyond default threshold", () => {
    expect(computeDlcStatus("2026-03-10", null)).toBe("ok"); // 4 days
    expect(computeDlcStatus("2026-04-01", null)).toBe("ok");
  });

  it("uses product-level warningDays when provided", () => {
    // Custom threshold of 5 days
    expect(computeDlcStatus("2026-03-11", 5)).toBe("warning"); // 5 days ≤ 5
    expect(computeDlcStatus("2026-03-12", 5)).toBe("ok");      // 6 days > 5
  });

  it("uses product warningDays=0 (only expired triggers)", () => {
    expect(computeDlcStatus("2026-03-06", 0)).toBe("warning"); // 0 days ≤ 0
    expect(computeDlcStatus("2026-03-07", 0)).toBe("ok");      // 1 day > 0
  });

  it("falls back to default when warningDays is null or undefined", () => {
    expect(computeDlcStatus("2026-03-09", null)).toBe("warning");
    expect(computeDlcStatus("2026-03-09", undefined)).toBe("warning");
  });
});

describe("computeDlcDaysRemaining", () => {
  it("returns positive days for future DLC", () => {
    expect(computeDlcDaysRemaining("2026-03-10")).toBe(4);
  });

  it("returns 0 for today", () => {
    expect(computeDlcDaysRemaining("2026-03-06")).toBe(0);
  });

  it("returns negative days for past DLC", () => {
    expect(computeDlcDaysRemaining("2026-03-04")).toBe(-2);
  });
});

describe("formatDlcDate", () => {
  it("converts ISO to French DD/MM/YYYY", () => {
    expect(formatDlcDate("2026-03-06")).toBe("06/03/2026");
    expect(formatDlcDate("2025-12-25")).toBe("25/12/2025");
  });
});

describe("dlcUrgencyComparator", () => {
  it("sorts expired before warning", () => {
    const a = { dlcDate: "2026-03-05" }; // expired
    const b = { dlcDate: "2026-03-07" }; // warning
    expect(dlcUrgencyComparator(a, b)).toBeLessThan(0);
  });

  it("sorts warning before ok", () => {
    const a = { dlcDate: "2026-03-07" }; // warning
    const b = { dlcDate: "2026-04-01" }; // ok
    expect(dlcUrgencyComparator(a, b)).toBeLessThan(0);
  });

  it("sorts by date within same status (closest first)", () => {
    const a = { dlcDate: "2026-03-07" }; // warning, 1 day
    const b = { dlcDate: "2026-03-09" }; // warning, 3 days
    expect(dlcUrgencyComparator(a, b)).toBeLessThan(0);
  });

  it("uses warningDays for status determination", () => {
    const a = { dlcDate: "2026-03-11", warningDays: 5 }; // warning (5 ≤ 5)
    const b = { dlcDate: "2026-03-11", warningDays: 2 }; // ok (5 > 2)
    expect(dlcUrgencyComparator(a, b)).toBeLessThan(0);
  });
});
