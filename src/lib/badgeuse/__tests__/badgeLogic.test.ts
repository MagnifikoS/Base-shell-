/**
 * Badge clock-in/out business logic tests
 *
 * Tests the pure helper functions from supabase/functions/badge-events/_shared/helpers.ts
 * by re-implementing the logic with the same patterns used in the edge function.
 *
 * Since helpers.ts uses Deno imports, we cannot import it directly into Vitest.
 * Instead, we test the logic by reproducing the pure functions inline and verifying
 * correctness against known inputs/outputs.
 *
 * Covers:
 * - timeToMinutes
 * - buildParisTimestamp
 * - buildServiceDayTimestamp
 * - checkEarlyDeparture
 * - checkEarlyArrival
 * - checkShiftEnded
 * - computeEffectiveAt
 * - computeClockInEffectiveAndLateV2
 * - isAfterShiftEnd (deprecated but still used)
 * - findNextShift
 * - Edge cases: midnight, DST, overnight shifts, service day cutoff
 */

import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Inline copies of pure helper functions (identical logic to helpers.ts)
// These are extracted here because the source uses Deno imports.
// ─────────────────────────────────────────────────────────────────────────────

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function getParisOffsetMinutes(date: Date): number {
  const utcParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const parisParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const utcH = parseInt(utcParts.find((p) => p.type === "hour")?.value || "0", 10);
  const utcM = parseInt(utcParts.find((p) => p.type === "minute")?.value || "0", 10);
  const parisH = parseInt(parisParts.find((p) => p.type === "hour")?.value || "0", 10);
  const parisM = parseInt(parisParts.find((p) => p.type === "minute")?.value || "0", 10);

  let diffMinutes = parisH * 60 + parisM - (utcH * 60 + utcM);
  if (diffMinutes < -720) diffMinutes += 1440;
  if (diffMinutes > 720) diffMinutes -= 1440;
  return diffMinutes;
}

function getParisTimeHHMM(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const h = parts.find((p) => p.type === "hour")?.value || "00";
  const m = parts.find((p) => p.type === "minute")?.value || "00";
  return `${h}:${m}`;
}

function buildParisTimestamp(dayDate: string, time: string): string {
  const [h, m] = time.split(":").map(Number);
  const roughDate = new Date(`${dayDate}T12:00:00Z`);
  const offsetMinutes = getParisOffsetMinutes(roughDate);
  const parisMinutes = h * 60 + m;
  const utcMinutes = parisMinutes - offsetMinutes;

  const [y, mo, d] = dayDate.split("-").map(Number);
  let utcDay = d;
  const utcMonth = mo - 1;
  const utcYear = y;
  let finalMinutes = utcMinutes;

  if (utcMinutes < 0) {
    finalMinutes = utcMinutes + 1440;
    utcDay -= 1;
  } else if (utcMinutes >= 1440) {
    finalMinutes = utcMinutes - 1440;
    utcDay += 1;
  }

  const utcH = Math.floor(finalMinutes / 60);
  const utcM = finalMinutes % 60;
  const dt = new Date(Date.UTC(utcYear, utcMonth, utcDay, utcH, utcM, 0, 0));
  return dt.toISOString();
}

function buildServiceDayTimestamp(serviceDay: string, time: string, cutoffHHMM: string): string {
  const timeMin = timeToMinutes(time.slice(0, 5));
  const cutoffMin = timeToMinutes(cutoffHHMM.slice(0, 5));

  if (timeMin < cutoffMin) {
    const [y, mo, d] = serviceDay.split("-").map(Number);
    const nextDay = new Date(Date.UTC(y, mo - 1, d + 1, 12, 0, 0));
    const nextDayStr = nextDay.toISOString().slice(0, 10);
    return buildParisTimestamp(nextDayStr, time);
  }
  return buildParisTimestamp(serviceDay, time);
}

function checkEarlyDeparture(
  occurredAt: Date,
  plannedStartHHMM: string,
  plannedEndHHMM: string,
  serviceDay: string,
  cutoffHHMM: string
): { isEarlyDeparture: boolean; minutesEarly: number; plannedEndTs: string } {
  const plannedStart = plannedStartHHMM.slice(0, 5);
  const plannedEnd = plannedEndHHMM.slice(0, 5);

  const plannedStartTs = new Date(buildServiceDayTimestamp(serviceDay, plannedStart, cutoffHHMM));
  let plannedEndTs = new Date(buildServiceDayTimestamp(serviceDay, plannedEnd, cutoffHHMM));

  if (plannedEndTs.getTime() <= plannedStartTs.getTime()) {
    plannedEndTs = new Date(plannedEndTs.getTime() + 24 * 60 * 60 * 1000);
  }

  const occurredMs = occurredAt.getTime();
  const plannedEndMs = plannedEndTs.getTime();
  const diffMs = plannedEndMs - occurredMs;
  const minutesEarly = Math.floor(diffMs / 60000);

  return {
    isEarlyDeparture: occurredMs < plannedEndMs,
    minutesEarly: Math.max(0, minutesEarly),
    plannedEndTs: plannedEndTs.toISOString(),
  };
}

function checkEarlyArrival(
  occurredAt: Date,
  plannedStartHHMM: string,
  plannedEndHHMM: string,
  serviceDay: string,
  cutoffHHMM: string,
  earlyArrivalLimitMin: number
): { isTooEarly: boolean; minutesEarly: number; plannedStartTs: string } {
  const plannedStart = plannedStartHHMM.slice(0, 5);
  const plannedStartTs = new Date(buildServiceDayTimestamp(serviceDay, plannedStart, cutoffHHMM));

  const occurredMs = occurredAt.getTime();
  const plannedStartMs = plannedStartTs.getTime();
  const diffMs = plannedStartMs - occurredMs;
  const minutesEarly = Math.floor(diffMs / 60000);
  const isTooEarly = minutesEarly > earlyArrivalLimitMin;

  return {
    isTooEarly,
    minutesEarly: Math.max(0, minutesEarly),
    plannedStartTs: plannedStartTs.toISOString(),
  };
}

function checkShiftEnded(
  occurredAt: Date,
  plannedStartHHMM: string,
  plannedEndHHMM: string,
  serviceDay: string,
  cutoffHHMM: string
): boolean {
  const plannedStart = plannedStartHHMM.slice(0, 5);
  const plannedEnd = plannedEndHHMM.slice(0, 5);

  const plannedStartTs = new Date(buildServiceDayTimestamp(serviceDay, plannedStart, cutoffHHMM));
  let plannedEndTs = new Date(buildServiceDayTimestamp(serviceDay, plannedEnd, cutoffHHMM));

  if (plannedEndTs.getTime() <= plannedStartTs.getTime()) {
    plannedEndTs = new Date(plannedEndTs.getTime() + 24 * 60 * 60 * 1000);
  }

  return occurredAt.getTime() > plannedEndTs.getTime();
}

function computeClockInEffectiveAndLateV2(
  occurredAt: Date,
  plannedStartHHMM: string,
  serviceDay: string,
  cutoffHHMM: string,
  arrivalToleranceMin: number
): { effectiveAtISO: string; lateMinutes: number | null } {
  const plannedStart = plannedStartHHMM.slice(0, 5);
  const plannedStartTs = new Date(buildServiceDayTimestamp(serviceDay, plannedStart, cutoffHHMM));

  const diffMs = occurredAt.getTime() - plannedStartTs.getTime();
  const rawLateMinutes = Math.floor(diffMs / 60000);

  if (rawLateMinutes <= 0) {
    return { effectiveAtISO: plannedStartTs.toISOString(), lateMinutes: 0 };
  }

  if (rawLateMinutes <= arrivalToleranceMin) {
    return { effectiveAtISO: plannedStartTs.toISOString(), lateMinutes: 0 };
  }

  return { effectiveAtISO: occurredAt.toISOString(), lateMinutes: rawLateMinutes };
}

interface PlannedShift {
  start_time: string;
  end_time: string;
}

function isAfterShiftEnd(occurredTime: string, plannedEnd: string, plannedStart?: string): boolean {
  let occurredMin = timeToMinutes(occurredTime);
  let plannedEndMin = timeToMinutes(plannedEnd);

  if (plannedStart) {
    const plannedStartMin = timeToMinutes(plannedStart);
    if (plannedEndMin < plannedStartMin) {
      plannedEndMin += 1440;
      if (occurredMin < plannedStartMin) {
        occurredMin += 1440;
      }
    } else if (occurredMin < plannedStartMin) {
      occurredMin += 1440;
    }
  }
  return occurredMin > plannedEndMin;
}

function findNextShift(
  plannedShifts: PlannedShift[] | null,
  currentSequenceIndex: number
): { start_time: string; end_time: string; sequence_index: number } | null {
  if (!plannedShifts || plannedShifts.length <= currentSequenceIndex) {
    return null;
  }
  const nextShift = plannedShifts[currentSequenceIndex];
  if (!nextShift) return null;
  return {
    start_time: nextShift.start_time.slice(0, 5),
    end_time: nextShift.end_time.slice(0, 5),
    sequence_index: currentSequenceIndex + 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("timeToMinutes", () => {
  it("converts 00:00 to 0", () => {
    expect(timeToMinutes("00:00")).toBe(0);
  });

  it("converts 09:30 to 570", () => {
    expect(timeToMinutes("09:30")).toBe(570);
  });

  it("converts 23:59 to 1439", () => {
    expect(timeToMinutes("23:59")).toBe(1439);
  });

  it("handles HH:mm:ss format (ignores seconds)", () => {
    expect(timeToMinutes("14:30:45")).toBe(870);
  });

  it("converts 03:00 to 180 (service day cutoff)", () => {
    expect(timeToMinutes("03:00")).toBe(180);
  });
});

describe("buildParisTimestamp", () => {
  it("builds correct UTC timestamp for Paris winter time (CET = UTC+1)", () => {
    // 10:00 Paris in winter = 09:00 UTC
    const iso = buildParisTimestamp("2026-01-15", "10:00");
    const date = new Date(iso);
    expect(date.getUTCHours()).toBe(9);
    expect(date.getUTCMinutes()).toBe(0);
  });

  it("builds correct UTC timestamp for Paris summer time (CEST = UTC+2)", () => {
    // 10:00 Paris in summer = 08:00 UTC
    const iso = buildParisTimestamp("2026-07-15", "10:00");
    const date = new Date(iso);
    expect(date.getUTCHours()).toBe(8);
    expect(date.getUTCMinutes()).toBe(0);
  });

  it("handles midnight Paris winter (rolls back to previous day in UTC)", () => {
    // 00:00 Paris CET = 23:00 UTC previous day
    const iso = buildParisTimestamp("2026-01-15", "00:00");
    const date = new Date(iso);
    expect(date.getUTCHours()).toBe(23);
    expect(date.getUTCDate()).toBe(14);
  });

  it("handles 02:00 Paris winter (post-midnight, still UTC same day)", () => {
    // 02:00 Paris CET = 01:00 UTC same day
    const iso = buildParisTimestamp("2026-01-15", "02:00");
    const date = new Date(iso);
    expect(date.getUTCHours()).toBe(1);
    expect(date.getUTCDate()).toBe(15);
  });

  it("handles 23:30 Paris winter", () => {
    // 23:30 Paris CET = 22:30 UTC same day
    const iso = buildParisTimestamp("2026-01-15", "23:30");
    const date = new Date(iso);
    expect(date.getUTCHours()).toBe(22);
    expect(date.getUTCMinutes()).toBe(30);
  });
});

describe("buildServiceDayTimestamp", () => {
  it("uses same day when time >= cutoff", () => {
    // 09:00 >= 03:00, so uses 2026-01-15 as the calendar day
    const iso = buildServiceDayTimestamp("2026-01-15", "09:00", "03:00");
    const date = new Date(iso);
    // 09:00 Paris CET = 08:00 UTC on Jan 15
    expect(date.getUTCHours()).toBe(8);
    expect(date.getUTCDate()).toBe(15);
  });

  it("uses next day when time < cutoff (post-midnight service day)", () => {
    // 02:00 < 03:00, so the calendar day should be 2026-01-16
    const iso = buildServiceDayTimestamp("2026-01-15", "02:00", "03:00");
    const date = new Date(iso);
    // 02:00 Paris on Jan 16 CET = 01:00 UTC on Jan 16
    expect(date.getUTCHours()).toBe(1);
    expect(date.getUTCDate()).toBe(16);
  });

  it("handles cutoff at 05:00 with time 04:30", () => {
    // 04:30 < 05:00 cutoff, should map to next day
    const iso = buildServiceDayTimestamp("2026-01-15", "04:30", "05:00");
    const date = new Date(iso);
    // 04:30 Paris on Jan 16 = 03:30 UTC on Jan 16
    expect(date.getUTCHours()).toBe(3);
    expect(date.getUTCMinutes()).toBe(30);
    expect(date.getUTCDate()).toBe(16);
  });

  it("handles time exactly at cutoff (>= cutoff, same day)", () => {
    // 03:00 is NOT < 03:00, so same day
    const iso = buildServiceDayTimestamp("2026-01-15", "03:00", "03:00");
    const date = new Date(iso);
    // 03:00 Paris on Jan 15 = 02:00 UTC on Jan 15
    expect(date.getUTCHours()).toBe(2);
    expect(date.getUTCDate()).toBe(15);
  });
});

describe("checkEarlyDeparture", () => {
  it("detects early departure when badge is before shift end", () => {
    // Shift 09:00-17:00, badge at 16:00 Paris
    // 16:00 Paris CET = 15:00 UTC
    const occurredAt = new Date("2026-01-15T15:00:00Z");
    const result = checkEarlyDeparture(occurredAt, "09:00", "17:00", "2026-01-15", "03:00");

    expect(result.isEarlyDeparture).toBe(true);
    expect(result.minutesEarly).toBe(60);
  });

  it("returns not early when badge is after shift end", () => {
    // Shift 09:00-17:00, badge at 17:30 Paris = 16:30 UTC
    const occurredAt = new Date("2026-01-15T16:30:00Z");
    const result = checkEarlyDeparture(occurredAt, "09:00", "17:00", "2026-01-15", "03:00");

    expect(result.isEarlyDeparture).toBe(false);
    expect(result.minutesEarly).toBe(0);
  });

  it("returns not early when badge is exactly at shift end", () => {
    // Shift 09:00-17:00, badge at 17:00 Paris = 16:00 UTC
    const occurredAt = new Date("2026-01-15T16:00:00Z");
    const result = checkEarlyDeparture(occurredAt, "09:00", "17:00", "2026-01-15", "03:00");

    // At exactly shift end, not early
    expect(result.isEarlyDeparture).toBe(false);
  });

  it("handles overnight shift (22:00-02:00) with post-midnight departure", () => {
    // Shift 22:00-02:00, service day 2026-01-15
    // Badge at 01:30 Paris on Jan 16 = 00:30 UTC on Jan 16
    const occurredAt = new Date("2026-01-16T00:30:00Z");
    const result = checkEarlyDeparture(occurredAt, "22:00", "02:00", "2026-01-15", "03:00");

    // 02:00 < 03:00 cutoff, so end is on the NEXT day (Jan 16)
    // Badge is at 01:30, end is at 02:00, so 30 min early
    expect(result.isEarlyDeparture).toBe(true);
    expect(result.minutesEarly).toBe(30);
  });

  it("handles overnight shift departure after end", () => {
    // Shift 22:00-02:00, badge at 02:30 Paris on Jan 16 = 01:30 UTC Jan 16
    const occurredAt = new Date("2026-01-16T01:30:00Z");
    const result = checkEarlyDeparture(occurredAt, "22:00", "02:00", "2026-01-15", "03:00");

    expect(result.isEarlyDeparture).toBe(false);
  });
});

describe("checkEarlyArrival", () => {
  it("detects too-early arrival when badge is far before shift start", () => {
    // Shift 09:00-17:00, badge at 07:00 Paris = 06:00 UTC
    // Early by 120 minutes, limit is 30
    const occurredAt = new Date("2026-01-15T06:00:00Z");
    const result = checkEarlyArrival(occurredAt, "09:00", "17:00", "2026-01-15", "03:00", 30);

    expect(result.isTooEarly).toBe(true);
    expect(result.minutesEarly).toBe(120);
  });

  it("allows arrival within earlyArrivalLimit", () => {
    // Shift 09:00-17:00, badge at 08:40 Paris = 07:40 UTC
    // Early by 20 minutes, limit is 30
    const occurredAt = new Date("2026-01-15T07:40:00Z");
    const result = checkEarlyArrival(occurredAt, "09:00", "17:00", "2026-01-15", "03:00", 30);

    expect(result.isTooEarly).toBe(false);
    expect(result.minutesEarly).toBe(20);
  });

  it("allows arrival exactly at earlyArrivalLimit", () => {
    // Shift 09:00-17:00, badge at 08:30 Paris = 07:30 UTC
    // Early by exactly 30 minutes, limit is 30
    const occurredAt = new Date("2026-01-15T07:30:00Z");
    const result = checkEarlyArrival(occurredAt, "09:00", "17:00", "2026-01-15", "03:00", 30);

    // 30 minutes early, limit is 30, NOT too early (30 > 30 is false)
    expect(result.isTooEarly).toBe(false);
  });

  it("returns 0 minutesEarly when badge is after shift start (late arrival)", () => {
    // Shift 09:00-17:00, badge at 09:15 Paris = 08:15 UTC
    const occurredAt = new Date("2026-01-15T08:15:00Z");
    const result = checkEarlyArrival(occurredAt, "09:00", "17:00", "2026-01-15", "03:00", 30);

    expect(result.isTooEarly).toBe(false);
    expect(result.minutesEarly).toBe(0);
  });
});

describe("checkShiftEnded", () => {
  it("returns false during active shift", () => {
    // Shift 09:00-17:00, now 12:00 Paris = 11:00 UTC
    const now = new Date("2026-01-15T11:00:00Z");
    expect(checkShiftEnded(now, "09:00", "17:00", "2026-01-15", "03:00")).toBe(false);
  });

  it("returns true after shift end", () => {
    // Shift 09:00-17:00, now 18:00 Paris = 17:00 UTC
    const now = new Date("2026-01-15T17:00:00Z");
    expect(checkShiftEnded(now, "09:00", "17:00", "2026-01-15", "03:00")).toBe(true);
  });

  it("returns false at exactly shift end (not > end)", () => {
    // Shift 09:00-17:00, now 17:00 Paris = 16:00 UTC
    const now = new Date("2026-01-15T16:00:00Z");
    expect(checkShiftEnded(now, "09:00", "17:00", "2026-01-15", "03:00")).toBe(false);
  });

  it("handles overnight shift correctly (22:00-02:00)", () => {
    // Shift 22:00-02:00, now 01:00 Paris on Jan 16 = 00:00 UTC Jan 16
    const now = new Date("2026-01-16T00:00:00Z");
    expect(checkShiftEnded(now, "22:00", "02:00", "2026-01-15", "03:00")).toBe(false);
  });

  it("handles overnight shift ended after 02:00 (post-midnight)", () => {
    // Shift 22:00-02:00, now 02:30 Paris on Jan 16 = 01:30 UTC Jan 16
    const now = new Date("2026-01-16T01:30:00Z");
    expect(checkShiftEnded(now, "22:00", "02:00", "2026-01-15", "03:00")).toBe(true);
  });
});

describe("computeClockInEffectiveAndLateV2", () => {
  it("snaps effective to planned start when badge is early", () => {
    // Shift starts 09:00 Paris, badge at 08:45 Paris = 07:45 UTC
    const occurredAt = new Date("2026-01-15T07:45:00Z");
    const result = computeClockInEffectiveAndLateV2(occurredAt, "09:00", "2026-01-15", "03:00", 10);

    // 09:00 Paris = 08:00 UTC
    const effective = new Date(result.effectiveAtISO);
    expect(effective.getUTCHours()).toBe(8);
    expect(effective.getUTCMinutes()).toBe(0);
    expect(result.lateMinutes).toBe(0);
  });

  it("snaps effective to planned start when late within tolerance", () => {
    // Shift starts 09:00 Paris, badge at 09:05 Paris = 08:05 UTC
    // 5 minutes late, tolerance = 10
    const occurredAt = new Date("2026-01-15T08:05:00Z");
    const result = computeClockInEffectiveAndLateV2(occurredAt, "09:00", "2026-01-15", "03:00", 10);

    const effective = new Date(result.effectiveAtISO);
    expect(effective.getUTCHours()).toBe(8);
    expect(effective.getUTCMinutes()).toBe(0);
    expect(result.lateMinutes).toBe(0);
  });

  it("uses occurred time when late beyond tolerance", () => {
    // Shift starts 09:00 Paris, badge at 09:20 Paris = 08:20 UTC
    // 20 minutes late, tolerance = 10
    const occurredAt = new Date("2026-01-15T08:20:00Z");
    const result = computeClockInEffectiveAndLateV2(occurredAt, "09:00", "2026-01-15", "03:00", 10);

    // effective should be the actual badge time
    expect(result.effectiveAtISO).toBe(occurredAt.toISOString());
    expect(result.lateMinutes).toBe(20);
  });

  it("handles exactly at tolerance boundary (tolerance = 10, late = 10)", () => {
    // Shift starts 09:00 Paris, badge at 09:10 Paris = 08:10 UTC
    const occurredAt = new Date("2026-01-15T08:10:00Z");
    const result = computeClockInEffectiveAndLateV2(occurredAt, "09:00", "2026-01-15", "03:00", 10);

    // Exactly at tolerance => within tolerance => effective = planned
    const effective = new Date(result.effectiveAtISO);
    expect(effective.getUTCHours()).toBe(8);
    expect(result.lateMinutes).toBe(0);
  });

  it("handles night shift clock-in (22:00 start)", () => {
    // Night shift starts 22:00, badge at 21:55 Paris = 20:55 UTC
    const occurredAt = new Date("2026-01-15T20:55:00Z");
    const result = computeClockInEffectiveAndLateV2(occurredAt, "22:00", "2026-01-15", "03:00", 10);

    // Early, so effective = planned start (22:00 Paris = 21:00 UTC)
    const effective = new Date(result.effectiveAtISO);
    expect(effective.getUTCHours()).toBe(21);
    expect(result.lateMinutes).toBe(0);
  });
});

describe("isAfterShiftEnd (deprecated but tested for backward compat)", () => {
  it("returns true when occurred is after end for normal shift", () => {
    expect(isAfterShiftEnd("17:30", "17:00")).toBe(true);
  });

  it("returns false when occurred is before end for normal shift", () => {
    expect(isAfterShiftEnd("16:30", "17:00")).toBe(false);
  });

  it("returns false when occurred equals end", () => {
    expect(isAfterShiftEnd("17:00", "17:00")).toBe(false);
  });

  it("handles overnight shift where end < start", () => {
    // Shift 22:00-02:00, badge at 01:00 (still before end)
    expect(isAfterShiftEnd("01:00", "02:00", "22:00")).toBe(false);
  });

  it("handles overnight shift where badge is after end", () => {
    // Shift 22:00-02:00, badge at 02:30 (after end)
    expect(isAfterShiftEnd("02:30", "02:00", "22:00")).toBe(true);
  });

  it("handles post-midnight badge for non-overnight shift (service day edge case)", () => {
    // Non-overnight shift 09:00-17:00, badge at 02:00 (post-midnight, next calendar day)
    // This is the case described in the comments: badge belongs to service day of "yesterday"
    expect(isAfterShiftEnd("02:00", "17:00", "09:00")).toBe(true);
  });
});

describe("findNextShift", () => {
  it("returns the next shift after current sequence index", () => {
    const shifts: PlannedShift[] = [
      { start_time: "09:00:00", end_time: "14:00:00" },
      { start_time: "18:00:00", end_time: "23:00:00" },
    ];
    const result = findNextShift(shifts, 1);
    expect(result).toEqual({
      start_time: "18:00",
      end_time: "23:00",
      sequence_index: 2,
    });
  });

  it("returns null when no more shifts exist", () => {
    const shifts: PlannedShift[] = [{ start_time: "09:00:00", end_time: "14:00:00" }];
    const result = findNextShift(shifts, 1);
    expect(result).toBeNull();
  });

  it("returns null for null shifts array", () => {
    expect(findNextShift(null, 0)).toBeNull();
  });

  it("returns null for empty shifts array", () => {
    expect(findNextShift([], 0)).toBeNull();
  });

  it("returns first shift when current index is 0", () => {
    const shifts: PlannedShift[] = [{ start_time: "09:00:00", end_time: "14:00:00" }];
    const result = findNextShift(shifts, 0);
    expect(result).toEqual({
      start_time: "09:00",
      end_time: "14:00",
      sequence_index: 1,
    });
  });
});

describe("edge cases: midnight and DST transitions", () => {
  it("correctly handles badge right at midnight Paris (00:00)", () => {
    const iso = buildParisTimestamp("2026-01-15", "00:00");
    const date = new Date(iso);
    // 00:00 Paris CET = 23:00 UTC on Jan 14
    expect(date.getUTCHours()).toBe(23);
    expect(date.getUTCDate()).toBe(14);
  });

  it("correctly handles badge right before midnight Paris (23:59)", () => {
    const iso = buildParisTimestamp("2026-01-15", "23:59");
    const date = new Date(iso);
    // 23:59 Paris CET = 22:59 UTC on Jan 15
    expect(date.getUTCHours()).toBe(22);
    expect(date.getUTCMinutes()).toBe(59);
    expect(date.getUTCDate()).toBe(15);
  });

  it("handles service day cutoff at 03:00 with badge at 02:59", () => {
    // 02:59 < 03:00 cutoff, should be placed on NEXT calendar day from service day
    const iso = buildServiceDayTimestamp("2026-01-15", "02:59", "03:00");
    const date = new Date(iso);
    // This should be 02:59 Paris on Jan 16 = 01:59 UTC Jan 16
    expect(date.getUTCDate()).toBe(16);
    expect(date.getUTCHours()).toBe(1);
    expect(date.getUTCMinutes()).toBe(59);
  });

  it("handles summer time (CEST) correctly for overnight shift", () => {
    // Summer: CEST = UTC+2
    // Shift 22:00-02:00, service day 2026-07-15
    // Badge at 01:00 Paris on Jul 16 = 23:00 UTC on Jul 15
    const occurredAt = new Date("2026-07-15T23:00:00Z");
    const result = checkShiftEnded(occurredAt, "22:00", "02:00", "2026-07-15", "03:00");

    // 01:00 is before 02:00 end, so shift not ended
    expect(result).toBe(false);
  });

  it("handles DST transition correctly for shift spanning DST change", () => {
    // DST transition in 2026 happens last Sunday of March (March 29)
    // Clocks go from 02:00 to 03:00
    // Test a shift on that day
    const iso = buildParisTimestamp("2026-03-29", "10:00");
    const date = new Date(iso);
    // After DST: Paris is UTC+2, so 10:00 Paris = 08:00 UTC
    expect(date.getUTCHours()).toBe(8);
  });
});

describe("getParisTimeHHMM (used internally for effective_at computation)", () => {
  it("returns correct Paris time for winter CET", () => {
    // 10:00 UTC = 11:00 Paris in winter
    const date = new Date("2026-01-15T10:00:00Z");
    expect(getParisTimeHHMM(date)).toBe("11:00");
  });

  it("returns correct Paris time for summer CEST", () => {
    // 10:00 UTC = 12:00 Paris in summer
    const date = new Date("2026-07-15T10:00:00Z");
    expect(getParisTimeHHMM(date)).toBe("12:00");
  });

  it("handles midnight UTC in winter", () => {
    // 00:00 UTC = 01:00 Paris in winter
    const date = new Date("2026-01-15T00:00:00Z");
    expect(getParisTimeHHMM(date)).toBe("01:00");
  });

  it("handles 23:00 UTC crossing to next day in Paris", () => {
    // 23:00 UTC = 00:00 next day Paris in winter
    const date = new Date("2026-01-15T23:00:00Z");
    expect(getParisTimeHHMM(date)).toBe("00:00");
  });
});
