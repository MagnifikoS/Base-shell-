/**
 * Tests for Weekly Planning Extras Calculation
 * 
 * These tests verify the Code du Travail compliant weekly calculation:
 * - Extras are calculated per civil week (Monday → Sunday)
 * - Each week is attached to the month of its Sunday
 * - Weeks are never split between months
 * 
 * @see /docs/payroll-extras-contract.md
 */

import { describe, it, expect } from "vitest";
import {
  computePlanningExtrasWeekly,
  type PlanningShiftRaw,
} from "../payroll.compute";

describe("computePlanningExtrasWeekly", () => {
  const BASE_35H = 35; // 35h/week contract

  // ─────────────────────────────────────────────────────────────────────────
  // Test #1: Semaine exacte base
  // ─────────────────────────────────────────────────────────────────────────
  it("should return 0 extras when worked hours equal contract hours (35h/35h)", () => {
    // Week: Mon 2026-01-26 → Sun 2026-02-01 (attached to February)
    const shifts: PlanningShiftRaw[] = [
      { shift_date: "2026-01-26", net_minutes: 420 }, // 7h
      { shift_date: "2026-01-27", net_minutes: 420 }, // 7h
      { shift_date: "2026-01-28", net_minutes: 420 }, // 7h
      { shift_date: "2026-01-29", net_minutes: 420 }, // 7h
      { shift_date: "2026-01-30", net_minutes: 420 }, // 7h = 35h total
    ];
    
    // Target February (Sunday 2026-02-01 is in February)
    const result = computePlanningExtrasWeekly(shifts, "2026-02", BASE_35H);
    expect(result).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test #2: Semaine avec dépassement
  // ─────────────────────────────────────────────────────────────────────────
  it("should return 10h extras when worked 45h on a 35h contract", () => {
    // Week: Mon 2026-01-26 → Sun 2026-02-01 (attached to February)
    const shifts: PlanningShiftRaw[] = [
      { shift_date: "2026-01-26", net_minutes: 540 }, // 9h
      { shift_date: "2026-01-27", net_minutes: 540 }, // 9h
      { shift_date: "2026-01-28", net_minutes: 540 }, // 9h
      { shift_date: "2026-01-29", net_minutes: 540 }, // 9h
      { shift_date: "2026-01-30", net_minutes: 540 }, // 9h = 45h total
    ];
    
    // Target February
    const result = computePlanningExtrasWeekly(shifts, "2026-02", BASE_35H);
    expect(result).toBe(600); // 10h = 600 minutes
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test #3: Semaine chevauchante Déc→Jan (dimanche = janvier)
  // ─────────────────────────────────────────────────────────────────────────
  it("should attach week Dec 29 → Jan 4 to January (Sunday is Jan 4)", () => {
    // Week: Mon 2025-12-29 → Sun 2026-01-04 (attached to January 2026)
    const shifts: PlanningShiftRaw[] = [
      { shift_date: "2025-12-29", net_minutes: 540 }, // 9h
      { shift_date: "2025-12-30", net_minutes: 540 }, // 9h
      { shift_date: "2025-12-31", net_minutes: 540 }, // 9h
      { shift_date: "2026-01-01", net_minutes: 540 }, // 9h (New Year)
      { shift_date: "2026-01-02", net_minutes: 540 }, // 9h = 45h total
    ];
    
    // Target January 2026 - should count this week
    const resultJan = computePlanningExtrasWeekly(shifts, "2026-01", BASE_35H);
    expect(resultJan).toBe(600); // 10h extras
    
    // Target December 2025 - should NOT count this week
    const resultDec = computePlanningExtrasWeekly(shifts, "2025-12", BASE_35H);
    expect(resultDec).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test #4: Semaine chevauchante Jan→Fév (dimanche = février)
  // ─────────────────────────────────────────────────────────────────────────
  it("should attach week Jan 26 → Feb 1 to February (Sunday is Feb 1)", () => {
    // Week: Mon 2026-01-26 → Sun 2026-02-01 (attached to February)
    const shifts: PlanningShiftRaw[] = [
      { shift_date: "2026-01-26", net_minutes: 540 }, // 9h
      { shift_date: "2026-01-27", net_minutes: 540 }, // 9h
      { shift_date: "2026-01-28", net_minutes: 540 }, // 9h
      { shift_date: "2026-01-29", net_minutes: 540 }, // 9h
      { shift_date: "2026-01-30", net_minutes: 540 }, // 9h = 45h total
    ];
    
    // Target February - should count this week
    const resultFeb = computePlanningExtrasWeekly(shifts, "2026-02", BASE_35H);
    expect(resultFeb).toBe(600); // 10h extras
    
    // Target January - should NOT count this week
    const resultJan = computePlanningExtrasWeekly(shifts, "2026-01", BASE_35H);
    expect(resultJan).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test #5: Mois avec 5 semaines
  // ─────────────────────────────────────────────────────────────────────────
  it("should count all 5 weeks attached to a month", () => {
    // March 2026 has 5 Sundays attached to it:
    // - Week Feb 23 → Mar 1 (Sunday Mar 1) 
    // - Week Mar 2 → Mar 8 (Sunday Mar 8)
    // - Week Mar 9 → Mar 15 (Sunday Mar 15)
    // - Week Mar 16 → Mar 22 (Sunday Mar 22)
    // - Week Mar 23 → Mar 29 (Sunday Mar 29)
    const shifts: PlanningShiftRaw[] = [
      // Week 1: Feb 23 → Mar 1 (40h = 5h extra)
      { shift_date: "2026-02-23", net_minutes: 480 },
      { shift_date: "2026-02-24", net_minutes: 480 },
      { shift_date: "2026-02-25", net_minutes: 480 },
      { shift_date: "2026-02-26", net_minutes: 480 },
      { shift_date: "2026-02-27", net_minutes: 480 },
      // Week 2: Mar 2 → Mar 8 (40h = 5h extra)
      { shift_date: "2026-03-02", net_minutes: 480 },
      { shift_date: "2026-03-03", net_minutes: 480 },
      { shift_date: "2026-03-04", net_minutes: 480 },
      { shift_date: "2026-03-05", net_minutes: 480 },
      { shift_date: "2026-03-06", net_minutes: 480 },
      // Week 3: Mar 9 → Mar 15 (35h = 0 extra)
      { shift_date: "2026-03-09", net_minutes: 420 },
      { shift_date: "2026-03-10", net_minutes: 420 },
      { shift_date: "2026-03-11", net_minutes: 420 },
      { shift_date: "2026-03-12", net_minutes: 420 },
      { shift_date: "2026-03-13", net_minutes: 420 },
      // Week 4: Mar 16 → Mar 22 (40h = 5h extra)
      { shift_date: "2026-03-16", net_minutes: 480 },
      { shift_date: "2026-03-17", net_minutes: 480 },
      { shift_date: "2026-03-18", net_minutes: 480 },
      { shift_date: "2026-03-19", net_minutes: 480 },
      { shift_date: "2026-03-20", net_minutes: 480 },
      // Week 5: Mar 23 → Mar 29 (40h = 5h extra)
      { shift_date: "2026-03-23", net_minutes: 480 },
      { shift_date: "2026-03-24", net_minutes: 480 },
      { shift_date: "2026-03-25", net_minutes: 480 },
      { shift_date: "2026-03-26", net_minutes: 480 },
      { shift_date: "2026-03-27", net_minutes: 480 },
    ];
    
    // March 2026: 4 weeks with extras (5h each) + 1 week without = 20h extras
    const result = computePlanningExtrasWeekly(shifts, "2026-03", BASE_35H);
    expect(result).toBe(1200); // 20h = 1200 minutes
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test #6: Extras badgeuse présents (séparation)
  // ─────────────────────────────────────────────────────────────────────────
  it("should calculate planning extras independently (badge extras are added separately)", () => {
    // This test verifies the function ONLY calculates planning extras
    // Badge extras are added separately in computePayrollEmployeeLine
    const shifts: PlanningShiftRaw[] = [
      { shift_date: "2026-01-05", net_minutes: 540 }, // 9h
      { shift_date: "2026-01-06", net_minutes: 540 }, // 9h
      { shift_date: "2026-01-07", net_minutes: 540 }, // 9h
      { shift_date: "2026-01-08", net_minutes: 540 }, // 9h
      { shift_date: "2026-01-09", net_minutes: 540 }, // 9h = 45h total
    ];
    
    // Week Jan 5 → Jan 11 (Sunday Jan 11 is in January)
    const result = computePlanningExtrasWeekly(shifts, "2026-01", BASE_35H);
    expect(result).toBe(600); // 10h planning extras
    
    // Badge extras would be added separately by the caller
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test #7: Semaine 0h travaillées (absence complète)
  // ─────────────────────────────────────────────────────────────────────────
  it("should return 0 extras when 0 hours worked in a week", () => {
    // Empty shifts for the week
    const shifts: PlanningShiftRaw[] = [];
    
    const result = computePlanningExtrasWeekly(shifts, "2026-01", BASE_35H);
    expect(result).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test #8: Semaine 53 (changement d'année)
  // ─────────────────────────────────────────────────────────────────────────
  it("should handle week 53 (year-end) correctly", () => {
    // Week 53 of 2026: Mon Dec 28 → Sun Jan 3, 2027 (attached to January 2027)
    const shifts: PlanningShiftRaw[] = [
      { shift_date: "2026-12-28", net_minutes: 540 }, // 9h Monday
      { shift_date: "2026-12-29", net_minutes: 540 }, // 9h Tuesday
      { shift_date: "2026-12-30", net_minutes: 540 }, // 9h Wednesday
      { shift_date: "2026-12-31", net_minutes: 540 }, // 9h Thursday
      { shift_date: "2027-01-02", net_minutes: 540 }, // 9h Friday (Jan 1 is holiday)
    ];
    
    // Target January 2027 - should count this week
    const resultJan2027 = computePlanningExtrasWeekly(shifts, "2027-01", BASE_35H);
    expect(resultJan2027).toBe(600); // 10h extras
    
    // Target December 2026 - should NOT count this week
    const resultDec2026 = computePlanningExtrasWeekly(shifts, "2026-12", BASE_35H);
    expect(resultDec2026).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test #9: Semaine sous la base (pas de négatif)
  // ─────────────────────────────────────────────────────────────────────────
  it("should return 0 extras (not negative) when worked less than contract hours", () => {
    // Week with only 30h worked (5h under contract)
    const shifts: PlanningShiftRaw[] = [
      { shift_date: "2026-01-05", net_minutes: 360 }, // 6h
      { shift_date: "2026-01-06", net_minutes: 360 }, // 6h
      { shift_date: "2026-01-07", net_minutes: 360 }, // 6h
      { shift_date: "2026-01-08", net_minutes: 360 }, // 6h
      { shift_date: "2026-01-09", net_minutes: 360 }, // 6h = 30h total
    ];
    
    const result = computePlanningExtrasWeekly(shifts, "2026-01", BASE_35H);
    expect(result).toBe(0); // Never negative
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test #10: Deux semaines mixtes (une dépasse, une non)
  // ─────────────────────────────────────────────────────────────────────────
  it("should only count extras from weeks that exceed contract hours", () => {
    const shifts: PlanningShiftRaw[] = [
      // Week 1: Jan 5 → Jan 11 (38h = 3h extra)
      { shift_date: "2026-01-05", net_minutes: 456 }, // 7.6h
      { shift_date: "2026-01-06", net_minutes: 456 }, // 7.6h
      { shift_date: "2026-01-07", net_minutes: 456 }, // 7.6h
      { shift_date: "2026-01-08", net_minutes: 456 }, // 7.6h
      { shift_date: "2026-01-09", net_minutes: 456 }, // 7.6h = 38h total
      
      // Week 2: Jan 12 → Jan 18 (32h = 0 extra)
      { shift_date: "2026-01-12", net_minutes: 384 }, // 6.4h
      { shift_date: "2026-01-13", net_minutes: 384 }, // 6.4h
      { shift_date: "2026-01-14", net_minutes: 384 }, // 6.4h
      { shift_date: "2026-01-15", net_minutes: 384 }, // 6.4h
      { shift_date: "2026-01-16", net_minutes: 384 }, // 6.4h = 32h total
    ];
    
    const result = computePlanningExtrasWeekly(shifts, "2026-01", BASE_35H);
    // Week 1: 38h - 35h = 3h = 180 min extras
    // Week 2: 32h - 35h = -3h = 0 extras (no negative)
    // Total: 180 minutes
    expect(result).toBe(180);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge case: Empty inputs
  // ─────────────────────────────────────────────────────────────────────────
  it("should handle empty shifts array", () => {
    const result = computePlanningExtrasWeekly([], "2026-01", BASE_35H);
    expect(result).toBe(0);
  });

  it("should handle 0 contract hours", () => {
    const shifts: PlanningShiftRaw[] = [
      { shift_date: "2026-01-05", net_minutes: 420 },
    ];
    const result = computePlanningExtrasWeekly(shifts, "2026-01", 0);
    expect(result).toBe(0);
  });
});
