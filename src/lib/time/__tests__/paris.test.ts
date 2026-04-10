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
  buildParisISO,
  normalizeToServiceDayTimeline,
} from "../paris";

describe("timeToMinutes", () => {
  it("converts HH:mm to minutes", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("01:00")).toBe(60);
    expect(timeToMinutes("12:30")).toBe(750);
    expect(timeToMinutes("23:59")).toBe(1439);
  });

  it("handles HH:mm:ss format", () => {
    expect(timeToMinutes("08:30:45")).toBe(510);
  });
});

describe("minutesToXhYY", () => {
  it("formats minutes correctly", () => {
    expect(minutesToXhYY(8)).toBe("0h08");
    expect(minutesToXhYY(50)).toBe("0h50");
    expect(minutesToXhYY(60)).toBe("1h00");
    expect(minutesToXhYY(135)).toBe("2h15");
    expect(minutesToXhYY(1440)).toBe("24h00");
  });

  it("returns dash for null, undefined, or zero", () => {
    expect(minutesToXhYY(null)).toBe("\u2014");
    expect(minutesToXhYY(undefined)).toBe("\u2014");
    expect(minutesToXhYY(0)).toBe("\u2014");
  });

  it("returns dash for negative values", () => {
    expect(minutesToXhYY(-10)).toBe("\u2014");
  });
});

describe("formatParisHHMM", () => {
  it("formats a UTC ISO string to Paris time", () => {
    // 2026-01-15T12:00:00Z -> Paris is UTC+1 in January -> 13:00
    const result = formatParisHHMM("2026-01-15T12:00:00Z");
    expect(result).toBe("13:00");
  });

  it("formats a Date object to Paris time", () => {
    const date = new Date("2026-01-15T12:00:00Z");
    const result = formatParisHHMM(date);
    expect(result).toBe("13:00");
  });

  it("handles Supabase space-separated timestamp format", () => {
    // Supabase may return "2026-01-15 12:00:00+00"
    const result = formatParisHHMM("2026-01-15 12:00:00+00");
    expect(result).toBe("13:00");
  });

  it("handles summer time (CEST = UTC+2)", () => {
    // 2026-07-15T12:00:00Z -> Paris is UTC+2 in July -> 14:00
    const result = formatParisHHMM("2026-07-15T12:00:00Z");
    expect(result).toBe("14:00");
  });

  it('returns "--:--" for invalid input', () => {
    expect(formatParisHHMM("not-a-date")).toBe("--:--");
  });
});

describe("formatParisDate", () => {
  it("formats a date to YYYY-MM-DD in Paris timezone", () => {
    // 2026-01-15T23:30:00Z -> In Paris (UTC+1) this is already 2026-01-16 at 00:30
    const result = formatParisDate("2026-01-15T23:30:00Z");
    expect(result).toBe("2026-01-16");
  });

  it("formats a Date object", () => {
    const date = new Date("2026-06-15T10:00:00Z");
    const result = formatParisDate(date);
    expect(result).toBe("2026-06-15");
  });
});

describe("getTodayParis", () => {
  it("returns a YYYY-MM-DD string", () => {
    const today = getTodayParis();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("getNowParisHHMM", () => {
  it("returns a HH:mm string", () => {
    const now = getNowParisHHMM();
    expect(now).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("formatParisDayShort", () => {
  it("returns a French weekday abbreviation for a date string", () => {
    // 2026-01-12 is a Monday
    const result = formatParisDayShort("2026-01-12");
    expect(result).toBe("lun.");
  });

  it("returns a French weekday abbreviation for a Date object", () => {
    // 2026-01-18 (Sunday) at noon UTC
    const date = new Date("2026-01-18T12:00:00Z");
    const result = formatParisDayShort(date);
    expect(result).toBe("dim.");
  });
});

describe("formatParisDayNumber", () => {
  it("returns the day number for a date string", () => {
    const result = formatParisDayNumber("2026-01-15");
    expect(result).toBe("15");
  });

  it("returns the day number for a Date object", () => {
    const date = new Date("2026-03-01T12:00:00Z");
    const result = formatParisDayNumber(date);
    expect(result).toBe("1");
  });
});

describe("buildParisISO", () => {
  it("builds a UTC ISO string from Paris date + time (winter CET)", () => {
    // Paris is UTC+1 in January, so 10:00 Paris = 09:00 UTC
    const iso = buildParisISO("2026-01-15", "10:00");
    const date = new Date(iso);
    expect(date.getUTCHours()).toBe(9);
    expect(date.getUTCMinutes()).toBe(0);
  });

  it("builds a UTC ISO string from Paris date + time (summer CEST)", () => {
    // Paris is UTC+2 in July, so 10:00 Paris = 08:00 UTC
    const iso = buildParisISO("2026-07-15", "10:00");
    const date = new Date(iso);
    expect(date.getUTCHours()).toBe(8);
    expect(date.getUTCMinutes()).toBe(0);
  });

  it("handles midnight in Paris (winter)", () => {
    // 00:00 Paris (CET) = 23:00 UTC previous day
    const iso = buildParisISO("2026-01-15", "00:00");
    const date = new Date(iso);
    expect(date.getUTCHours()).toBe(23);
    expect(date.getUTCDate()).toBe(14); // rolled back to previous day
  });
});

describe("normalizeToServiceDayTimeline", () => {
  it("returns minutes as-is when time is after cutoff", () => {
    // 23:28 with cutoff 03:00 -> 1408 (no adjustment)
    expect(normalizeToServiceDayTimeline("23:28", "03:00")).toBe(1408);
  });

  it("adds 1440 when time is before cutoff (post-midnight)", () => {
    // 01:00 with cutoff 03:00 -> 60 + 1440 = 1500
    expect(normalizeToServiceDayTimeline("01:00", "03:00")).toBe(1500);
  });

  it("does not adjust when time equals or exceeds cutoff", () => {
    // 03:30 with cutoff 03:00 -> 210 (no adjustment)
    expect(normalizeToServiceDayTimeline("03:30", "03:00")).toBe(210);
  });

  it("uses default cutoff of 03:00 when not specified", () => {
    expect(normalizeToServiceDayTimeline("02:00")).toBe(120 + 1440);
    expect(normalizeToServiceDayTimeline("04:00")).toBe(240);
  });

  it("handles exact cutoff time as after cutoff (no adjustment)", () => {
    // 03:00 with cutoff 03:00 -> 180 (no adjustment, since not < cutoff)
    expect(normalizeToServiceDayTimeline("03:00", "03:00")).toBe(180);
  });
});
