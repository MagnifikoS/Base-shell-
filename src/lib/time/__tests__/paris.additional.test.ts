/**
 * Additional tests for paris.ts — Paris timezone helpers
 * Supplements the existing paris.test.ts with deep edge cases:
 * - DST transition boundaries
 * - Midnight crossing
 * - Supabase timestamp edge formats
 * - Service day normalization edge cases
 * - buildParisISO edge cases
 * - formatParisLocale and formatParisDate edge cases
 */

import { describe, it, expect } from "vitest";
import {
  timeToMinutes,
  minutesToXhYY,
  formatParisHHMM,
  formatParisDate,
  getTodayParis,
  getNowParisHHMM,
  formatParisDayShort,
  formatParisDayNumber,
  formatParisLocale,
  buildParisISO,
  normalizeToServiceDayTimeline,
} from "../paris";

// ═══════════════════════════════════════════════════════════════════════════════
// timeToMinutes — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("timeToMinutes — edge cases", () => {
  it("handles midnight (00:00) as 0", () => {
    expect(timeToMinutes("00:00")).toBe(0);
  });

  it("handles one minute before midnight (23:59)", () => {
    expect(timeToMinutes("23:59")).toBe(1439);
  });

  it("handles noon (12:00)", () => {
    expect(timeToMinutes("12:00")).toBe(720);
  });

  it("handles single-digit hour format (9:30 without leading zero)", () => {
    // parseInt will parse "9" correctly from "9:30"
    expect(timeToMinutes("9:30")).toBe(570);
  });

  it("handles 00:01 as 1 minute", () => {
    expect(timeToMinutes("00:01")).toBe(1);
  });

  it("handles exactly midnight plus seconds (00:00:30)", () => {
    // Only parses hours and minutes
    expect(timeToMinutes("00:00:30")).toBe(0);
  });

  it("handles 06:00 early morning", () => {
    expect(timeToMinutes("06:00")).toBe(360);
  });

  it("handles typical restaurant shift start (10:30)", () => {
    expect(timeToMinutes("10:30")).toBe(630);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// minutesToXhYY — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("minutesToXhYY — additional edge cases", () => {
  it("formats exactly 1 minute", () => {
    expect(minutesToXhYY(1)).toBe("0h01");
  });

  it("formats 59 minutes (just under 1 hour)", () => {
    expect(minutesToXhYY(59)).toBe("0h59");
  });

  it("formats 61 minutes (just over 1 hour)", () => {
    expect(minutesToXhYY(61)).toBe("1h01");
  });

  it("formats very large value (48 hours)", () => {
    expect(minutesToXhYY(2880)).toBe("48h00");
  });

  it("returns dash for -1", () => {
    expect(minutesToXhYY(-1)).toBe("\u2014");
  });

  it("formats 420 minutes (7h = daily work)", () => {
    expect(minutesToXhYY(420)).toBe("7h00");
  });

  it("formats 121 minutes", () => {
    expect(minutesToXhYY(121)).toBe("2h01");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatParisHHMM — DST transitions and edge formats
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatParisHHMM — DST and edge cases", () => {
  it("handles DST spring forward boundary (last Sunday of March 2026)", () => {
    // 2026-03-29 at 01:00 UTC = 02:00 CET -> clocks jump to 03:00 CEST
    // So 01:00 UTC = 03:00 Paris CEST
    const result = formatParisHHMM("2026-03-29T01:00:00Z");
    expect(result).toBe("03:00");
  });

  it("handles DST fall back boundary (last Sunday of October 2026)", () => {
    // 2026-10-25 at 01:00 UTC = 02:00 CEST -> clocks go back to 02:00 CET
    // After fall-back: 01:00 UTC = 02:00 CET
    const result = formatParisHHMM("2026-10-25T01:00:00Z");
    expect(result).toBe("02:00");
  });

  it("handles midnight UTC in summer (becomes 02:00 Paris)", () => {
    // 2026-07-15T00:00:00Z -> Paris CEST (UTC+2) -> 02:00
    expect(formatParisHHMM("2026-07-15T00:00:00Z")).toBe("02:00");
  });

  it("handles 22:00 UTC in winter (becomes 23:00 Paris)", () => {
    expect(formatParisHHMM("2026-01-15T22:00:00Z")).toBe("23:00");
  });

  it("handles Supabase format with positive offset (+02)", () => {
    // Already in CEST offset
    const result = formatParisHHMM("2026-07-15 14:30:00+02");
    expect(result).toBe("14:30");
  });

  it("handles Supabase format with negative offset", () => {
    // Hypothetical: timestamp with -05 offset
    const result = formatParisHHMM("2026-01-15 12:00:00-05");
    // -05 means UTC-5, so UTC = 17:00, Paris CET (UTC+1) = 18:00
    expect(result).toBe("18:00");
  });

  it("handles ISO format without timezone (assumes UTC)", () => {
    const result = formatParisHHMM("2026-01-15T12:00:00");
    // No TZ -> assumes UTC -> Paris CET (UTC+1) -> 13:00
    expect(result).toBe("13:00");
  });

  it("handles empty string gracefully", () => {
    expect(formatParisHHMM("")).toBe("--:--");
  });

  it("handles Date at exact midnight UTC", () => {
    const date = new Date("2026-06-15T00:00:00Z");
    // Summer CEST = UTC+2 -> 02:00
    expect(formatParisHHMM(date)).toBe("02:00");
  });

  it("handles Date at 23:59:59 UTC in winter", () => {
    const date = new Date("2026-12-31T23:59:59Z");
    // CET = UTC+1 -> 00:59 (next day)
    expect(formatParisHHMM(date)).toBe("00:59");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatParisDate — edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatParisDate — additional edge cases", () => {
  it("handles end-of-year midnight crossing (UTC 2026-12-31T23:30 -> Paris 2027-01-01)", () => {
    const result = formatParisDate("2026-12-31T23:30:00Z");
    // Paris CET = UTC+1 -> 2027-01-01 00:30
    expect(result).toBe("2027-01-01");
  });

  it("handles February 28 midnight in non-leap year", () => {
    const result = formatParisDate("2026-02-28T23:30:00Z");
    // Paris CET = UTC+1 -> 2026-03-01
    expect(result).toBe("2026-03-01");
  });

  it("handles February 29 in leap year", () => {
    const result = formatParisDate("2024-02-29T12:00:00Z");
    expect(result).toBe("2024-02-29");
  });

  it("returns today's date for invalid string input", () => {
    const result = formatParisDate("not-a-date");
    // Should return today in Paris, just check format
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatParisDayShort — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatParisDayShort — all days of week", () => {
  it("returns 'mar.' for Tuesday (2026-01-13)", () => {
    expect(formatParisDayShort("2026-01-13")).toBe("mar.");
  });

  it("returns 'mer.' for Wednesday (2026-01-14)", () => {
    expect(formatParisDayShort("2026-01-14")).toBe("mer.");
  });

  it("returns 'jeu.' for Thursday (2026-01-15)", () => {
    expect(formatParisDayShort("2026-01-15")).toBe("jeu.");
  });

  it("returns 'ven.' for Friday (2026-01-16)", () => {
    expect(formatParisDayShort("2026-01-16")).toBe("ven.");
  });

  it("returns 'sam.' for Saturday (2026-01-17)", () => {
    expect(formatParisDayShort("2026-01-17")).toBe("sam.");
  });

  it("returns '---' for invalid date string", () => {
    expect(formatParisDayShort("invalid")).toBe("---");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatParisDayNumber — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatParisDayNumber — additional edge cases", () => {
  it("returns '1' for first of month", () => {
    expect(formatParisDayNumber("2026-01-01")).toBe("1");
  });

  it("returns '31' for January 31st", () => {
    expect(formatParisDayNumber("2026-01-31")).toBe("31");
  });

  it("returns '-' for invalid date", () => {
    expect(formatParisDayNumber("not-a-date")).toBe("-");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatParisLocale — additional tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatParisLocale", () => {
  it("formats month name in French", () => {
    const result = formatParisLocale("2026-01-15", { month: "long" });
    expect(result).toBe("janvier");
  });

  it("formats weekday in French", () => {
    // 2026-01-12 is Monday
    const result = formatParisLocale("2026-01-12", { weekday: "long" });
    expect(result).toBe("lundi");
  });

  it("formats full date with day and month", () => {
    const result = formatParisLocale("2026-06-15", { day: "numeric", month: "long" });
    expect(result).toBe("15 juin");
  });

  it("returns '-' for invalid input", () => {
    const result = formatParisLocale("invalid", { month: "long" });
    expect(result).toBe("-");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildParisISO — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildParisISO — additional edge cases", () => {
  it("handles 01:00 Paris in winter (00:00 UTC same day)", () => {
    const iso = buildParisISO("2026-01-15", "01:00");
    const date = new Date(iso);
    expect(date.getUTCHours()).toBe(0);
    expect(date.getUTCDate()).toBe(15);
  });

  it("handles 23:59 Paris in winter (22:59 UTC same day)", () => {
    const iso = buildParisISO("2026-01-15", "23:59");
    const date = new Date(iso);
    expect(date.getUTCHours()).toBe(22);
    expect(date.getUTCMinutes()).toBe(59);
  });

  it("handles midnight in summer CEST (22:00 UTC previous day)", () => {
    const iso = buildParisISO("2026-07-15", "00:00");
    const date = new Date(iso);
    expect(date.getUTCHours()).toBe(22);
    expect(date.getUTCDate()).toBe(14); // previous day
  });

  it("handles noon in summer (10:00 UTC)", () => {
    const iso = buildParisISO("2026-07-15", "12:00");
    const date = new Date(iso);
    expect(date.getUTCHours()).toBe(10);
    expect(date.getUTCMinutes()).toBe(0);
  });

  it("returns valid ISO string format", () => {
    const iso = buildParisISO("2026-01-15", "10:00");
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it("handles late night time (02:00) correctly in winter", () => {
    const iso = buildParisISO("2026-01-15", "02:00");
    const date = new Date(iso);
    // 02:00 CET = 01:00 UTC
    expect(date.getUTCHours()).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// normalizeToServiceDayTimeline — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("normalizeToServiceDayTimeline — additional edge cases", () => {
  it("handles custom cutoff of 05:00", () => {
    // 04:00 < 05:00 cutoff -> should add 1440
    expect(normalizeToServiceDayTimeline("04:00", "05:00")).toBe(240 + 1440);
    // 05:30 >= 05:00 cutoff -> no adjustment
    expect(normalizeToServiceDayTimeline("05:30", "05:00")).toBe(330);
  });

  it("handles custom cutoff of 00:00 (no overnight handling)", () => {
    // 00:00 cutoff: nothing is before cutoff (0 < 0 is false)
    expect(normalizeToServiceDayTimeline("23:00", "00:00")).toBe(1380);
    expect(normalizeToServiceDayTimeline("00:00", "00:00")).toBe(0);
  });

  it("handles 00:01 with default cutoff 03:00", () => {
    // 1 minute is before 03:00 cutoff -> add 1440
    expect(normalizeToServiceDayTimeline("00:01", "03:00")).toBe(1 + 1440);
  });

  it("handles 02:59 just before default cutoff", () => {
    // 179 < 180 -> add 1440
    expect(normalizeToServiceDayTimeline("02:59", "03:00")).toBe(179 + 1440);
  });

  it("handles midnight 00:00 with default cutoff", () => {
    // 0 < 180 -> add 1440
    expect(normalizeToServiceDayTimeline("00:00", "03:00")).toBe(0 + 1440);
  });

  it("handles 12:00 midday with default cutoff (no adjustment)", () => {
    expect(normalizeToServiceDayTimeline("12:00", "03:00")).toBe(720);
  });

  it("handles cutoff of 06:00 for early-morning restaurants", () => {
    // 05:00 < 06:00 -> add 1440
    expect(normalizeToServiceDayTimeline("05:00", "06:00")).toBe(300 + 1440);
    // 06:00 >= 06:00 -> no adjustment
    expect(normalizeToServiceDayTimeline("06:00", "06:00")).toBe(360);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getTodayParis / getNowParisHHMM — format validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("getTodayParis — format validation", () => {
  it("returns a string of length 10", () => {
    expect(getTodayParis().length).toBe(10);
  });

  it("has hyphens at correct positions", () => {
    const today = getTodayParis();
    expect(today[4]).toBe("-");
    expect(today[7]).toBe("-");
  });
});

describe("getNowParisHHMM — format validation", () => {
  it("returns a string of length 5", () => {
    expect(getNowParisHHMM().length).toBe(5);
  });

  it("has a colon at position 2", () => {
    const now = getNowParisHHMM();
    expect(now[2]).toBe(":");
  });

  it("hours are between 00 and 23", () => {
    const now = getNowParisHHMM();
    const hours = parseInt(now.slice(0, 2), 10);
    expect(hours).toBeGreaterThanOrEqual(0);
    expect(hours).toBeLessThanOrEqual(23);
  });

  it("minutes are between 00 and 59", () => {
    const now = getNowParisHHMM();
    const minutes = parseInt(now.slice(3, 5), 10);
    expect(minutes).toBeGreaterThanOrEqual(0);
    expect(minutes).toBeLessThanOrEqual(59);
  });
});
