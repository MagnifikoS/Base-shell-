/**
 * Comprehensive tests for the Payroll Computation Engine
 *
 * This file tests all exported pure functions from payroll.compute.ts.
 * French labor law rules verified:
 * - Weekly overtime = per civil week (Monday->Sunday), attached to month of Sunday
 * - WEEKS_PER_MONTH = 52/12 (~4.333...)
 * - DAILY_WORK_MINUTES = 420 (7h/day)
 * - CP counted but NOT deducted from salary
 * - Absences deducted using hourlyRateOperational
 *
 * Realistic French payroll values are used throughout:
 * - SMIC ~11.65 EUR/h (2024 reference)
 * - Typical contracts: 35h/week or 39h/week
 * - Typical gross: 1800-3000 EUR/month
 */

import { describe, it, expect } from "vitest";
import {
  // Constants
  DAILY_WORK_MINUTES,
  WEEKS_PER_MONTH,
  // Core functions
  roundCurrency,
  computeMonthlyHours,
  computeHourlyRateOperational,
  computeHourlyRate,
  computeChargesFixed,
  computeCharges,
  computeHourlyRateWithCash,
  // Extra time (badge)
  computeExtraMinutes,
  computeExtraAmount,
  // Absence
  computeAbsenceMinutes,
  computeAbsenceAmount,
  // Time deductions
  computeTimeDeductionMinutes,
  computeTimeDeductionAmount,
  // Employee line
  computePayrollEmployeeLine,
  computeAdjustedGross,
  computeAdjustedTotalSalary,
  computeAdjustedGrossValidated,
  // Due breakdown
  computeDueBreakdownSimplified,
  // R-Extra
  computeRExtraDecision,
  // Totals
  computePayrollTotalsFromEmployees,
  // Aggregation helpers
  sumLateMinutes,
  sumEarlyDepartureMinutes,
  computeHeuresARetirer,
  formatMinutesToHHMM,
  countCpDays,
  countAbsenceDays,
  computePlanningPayrollCost,
  // Weekly planning extras (already tested in sibling file, but included here for integration)
  // Types
  type EmployeeContract,
  type ExtraEventLite,
  type PayrollEmployeeInputs,
  type PayrollEmployeeLine,
  type PayrollValidationFlags,
  type PayrollEmployeeForTotals,
  DEFAULT_VALIDATION_FLAGS,
} from "../payroll.compute";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: Realistic French payroll fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Standard 35h/week full-time contract at ~2200 EUR gross */
function makeContract35h(overrides?: Partial<EmployeeContract>): EmployeeContract {
  return {
    gross_salary: 2200,
    net_salary: 1750,
    contract_hours: 35,
    cp_n1: 10,
    cp_n: 5,
    total_salary: 1750,
    ...overrides,
  };
}

/** Standard 39h/week full-time contract at ~3000 EUR gross */
function makeContract39h(overrides?: Partial<EmployeeContract>): EmployeeContract {
  return {
    gross_salary: 3000,
    net_salary: 2400,
    contract_hours: 39,
    cp_n1: 12,
    cp_n: 8,
    total_salary: 2400,
    ...overrides,
  };
}

/** Minimal inputs for computePayrollEmployeeLine */
function makePayrollInputs(overrides?: Partial<PayrollEmployeeInputs>): PayrollEmployeeInputs {
  return {
    contract: makeContract35h(),
    extraEvents: [],
    cpDays: 0,
    absenceDeclaredDays: 0,
    absenceBadgeDays: 0,
    lateMinutesTotal: 0,
    earlyDepartureMinutesTotal: 0,
    workedMinutesMonth: 0,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Constants
// ═══════════════════════════════════════════════════════════════════════════════

describe("payroll.compute constants", () => {
  it("DAILY_WORK_MINUTES should be 420 (7h/day per French labor law)", () => {
    expect(DAILY_WORK_MINUTES).toBe(420);
  });

  it("WEEKS_PER_MONTH should be 52/12 (French labor law constant)", () => {
    expect(WEEKS_PER_MONTH).toBe(52 / 12);
    // Approximately 4.333...
    expect(WEEKS_PER_MONTH).toBeCloseTo(4.3333, 3);
  });

  it("DEFAULT_VALIDATION_FLAGS should have all flags disabled", () => {
    expect(DEFAULT_VALIDATION_FLAGS).toEqual({
      includeExtras: false,
      includeAbsences: false,
      includeDeductions: false,
      cashPaid: false,
      netPaid: false,
      extrasPaidEur: null,
      netAmountPaid: null,
      cashAmountPaid: null,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: roundCurrency
// ═══════════════════════════════════════════════════════════════════════════════

describe("roundCurrency", () => {
  it("should round to 2 decimal places (standard)", () => {
    expect(roundCurrency(17.776666)).toBe(17.78);
  });

  it("should round down when third decimal < 5", () => {
    expect(roundCurrency(10.123)).toBe(10.12);
  });

  it("should round up when third decimal >= 5", () => {
    expect(roundCurrency(10.125)).toBe(10.13);
  });

  it("should handle exact 2-decimal values unchanged", () => {
    expect(roundCurrency(100.5)).toBe(100.5);
  });

  it("should handle zero", () => {
    expect(roundCurrency(0)).toBe(0);
  });

  it("should handle negative values", () => {
    expect(roundCurrency(-15.678)).toBe(-15.68);
  });

  it("should handle very small amounts (centimes)", () => {
    expect(roundCurrency(0.001)).toBe(0);
    expect(roundCurrency(0.005)).toBe(0.01);
    expect(roundCurrency(0.009)).toBe(0.01);
  });

  it("should handle large payroll amounts", () => {
    expect(roundCurrency(123456.789)).toBe(123456.79);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: computeMonthlyHours
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeMonthlyHours", () => {
  it("should compute monthly hours for 35h/week contract", () => {
    const result = computeMonthlyHours(35);
    // 35 * 52/12 = 151.666...
    expect(result).toBeCloseTo(151.6667, 3);
  });

  it("should compute monthly hours for 39h/week contract", () => {
    const result = computeMonthlyHours(39);
    // 39 * 52/12 = 169
    expect(result).toBe(169);
  });

  it("should compute monthly hours for part-time 20h/week", () => {
    const result = computeMonthlyHours(20);
    // 20 * 52/12 = 86.666...
    expect(result).toBeCloseTo(86.6667, 3);
  });

  it("should return 0 for 0 contract hours", () => {
    expect(computeMonthlyHours(0)).toBe(0);
  });

  it("should return 0 for negative contract hours", () => {
    expect(computeMonthlyHours(-10)).toBe(0);
  });

  it("should return 0 for NaN", () => {
    expect(computeMonthlyHours(NaN)).toBe(0);
  });

  it("should return 0 for Infinity", () => {
    expect(computeMonthlyHours(Infinity)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: computeHourlyRateOperational
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeHourlyRateOperational", () => {
  it("should compute rate for typical 35h contract (total_salary / monthlyHours)", () => {
    const monthlyHours = computeMonthlyHours(35);
    const rate = computeHourlyRateOperational(1750, monthlyHours);
    // 1750 / 151.6667 ~= 11.538...
    expect(rate).toBeCloseTo(11.538, 2);
  });

  it("should compute rate for 39h contract", () => {
    const monthlyHours = computeMonthlyHours(39); // 169
    const rate = computeHourlyRateOperational(2400, monthlyHours);
    // 2400 / 169 ~= 14.20
    expect(rate).toBeCloseTo(14.201, 2);
  });

  it("should return 0 when monthlyHours is 0", () => {
    expect(computeHourlyRateOperational(2000, 0)).toBe(0);
  });

  it("should return 0 when monthlyHours is negative", () => {
    expect(computeHourlyRateOperational(2000, -10)).toBe(0);
  });

  it("should handle 0 salary", () => {
    const rate = computeHourlyRateOperational(0, 151);
    expect(rate).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: computeHourlyRate (deprecated, backward compat)
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeHourlyRate (deprecated)", () => {
  it("should compute gross-based hourly rate", () => {
    const monthlyHours = computeMonthlyHours(39); // 169
    const rate = computeHourlyRate(3000, monthlyHours);
    // 3000 / 169 ~= 17.751
    expect(rate).toBeCloseTo(17.751, 2);
  });

  it("should return 0 when monthlyHours is 0", () => {
    expect(computeHourlyRate(3000, 0)).toBe(0);
  });

  it("should return 0 when monthlyHours is negative", () => {
    expect(computeHourlyRate(3000, -5)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: computeChargesFixed / computeCharges
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeChargesFixed", () => {
  it("should compute charges as gross - net for typical employee", () => {
    const charges = computeChargesFixed(3000, 2400);
    expect(charges).toBe(600);
  });

  it("should return 0 when gross equals net (no charges)", () => {
    expect(computeChargesFixed(2000, 2000)).toBe(0);
  });

  it("should clamp to 0 when net > gross (prevents negative charges)", () => {
    expect(computeChargesFixed(1000, 1500)).toBe(0);
  });

  it("should return 0 for NaN gross", () => {
    expect(computeChargesFixed(NaN, 1000)).toBe(0);
  });

  it("should return 0 for NaN net", () => {
    expect(computeChargesFixed(1000, NaN)).toBe(0);
  });

  it("should return 0 for Infinity values", () => {
    expect(computeChargesFixed(Infinity, 1000)).toBe(0);
  });

  it("should handle zero salary", () => {
    expect(computeChargesFixed(0, 0)).toBe(0);
  });
});

describe("computeCharges (deprecated)", () => {
  it("should delegate to computeChargesFixed", () => {
    expect(computeCharges(3000, 2400)).toBe(computeChargesFixed(3000, 2400));
    expect(computeCharges(1000, 1500)).toBe(computeChargesFixed(1000, 1500));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: computeHourlyRateWithCash
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeHourlyRateWithCash", () => {
  it("should compute (gross + cash) / monthlyHours", () => {
    const monthlyHours = computeMonthlyHours(39); // 169
    // gross=3000, cash=200
    const rate = computeHourlyRateWithCash(3000, 200, monthlyHours);
    // (3000 + 200) / 169 ~= 18.935
    expect(rate).toBeCloseTo(18.935, 2);
  });

  it("should equal gross/monthlyHours when cash is 0", () => {
    const monthlyHours = computeMonthlyHours(35);
    const rate = computeHourlyRateWithCash(2200, 0, monthlyHours);
    expect(rate).toBeCloseTo(2200 / monthlyHours, 5);
  });

  it("should return 0 when monthlyHours is 0", () => {
    expect(computeHourlyRateWithCash(3000, 200, 0)).toBe(0);
  });

  it("should return 0 when monthlyHours is negative", () => {
    expect(computeHourlyRateWithCash(3000, 200, -10)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: computeExtraMinutes (Badge extras)
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeExtraMinutes", () => {
  it("should sum only approved extra events", () => {
    const events: ExtraEventLite[] = [
      { extra_minutes: 60, status: "approved" },
      { extra_minutes: 30, status: "pending" },
      { extra_minutes: 45, status: "approved" },
      { extra_minutes: 20, status: "rejected" },
    ];
    expect(computeExtraMinutes(events)).toBe(105); // 60 + 45
  });

  it("should return 0 for empty array", () => {
    expect(computeExtraMinutes([])).toBe(0);
  });

  it("should return 0 when all events are pending", () => {
    const events: ExtraEventLite[] = [
      { extra_minutes: 60, status: "pending" },
      { extra_minutes: 30, status: "pending" },
    ];
    expect(computeExtraMinutes(events)).toBe(0);
  });

  it("should return 0 when all events are rejected", () => {
    const events: ExtraEventLite[] = [
      { extra_minutes: 60, status: "rejected" },
      { extra_minutes: 30, status: "rejected" },
    ];
    expect(computeExtraMinutes(events)).toBe(0);
  });

  it("should handle a single approved event", () => {
    const events: ExtraEventLite[] = [{ extra_minutes: 120, status: "approved" }];
    expect(computeExtraMinutes(events)).toBe(120);
  });

  it("should handle large extra minutes", () => {
    const events: ExtraEventLite[] = [
      { extra_minutes: 600, status: "approved" }, // 10 hours
      { extra_minutes: 480, status: "approved" }, // 8 hours
    ];
    expect(computeExtraMinutes(events)).toBe(1080); // 18 hours
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: computeExtraAmount
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeExtraAmount", () => {
  it("should convert extra minutes to EUR using hourly rate", () => {
    // 120 minutes at 15 EUR/h = 2h * 15 = 30.00 EUR
    expect(computeExtraAmount(120, 15)).toBe(30.0);
  });

  it("should round to 2 decimal places", () => {
    // 45 minutes at 17.77 EUR/h = 0.75h * 17.77 = 13.3275 -> 13.33
    expect(computeExtraAmount(45, 17.77)).toBe(13.33);
  });

  it("should return 0 for 0 extra minutes", () => {
    expect(computeExtraAmount(0, 15)).toBe(0);
  });

  it("should return 0 for NaN extraMinutes", () => {
    expect(computeExtraAmount(NaN, 15)).toBe(0);
  });

  it("should return 0 for NaN hourlyRate", () => {
    expect(computeExtraAmount(120, NaN)).toBe(0);
  });

  it("should return 0 for Infinity hourlyRate", () => {
    expect(computeExtraAmount(120, Infinity)).toBe(0);
  });

  it("should handle very small extra amounts (1 minute)", () => {
    // 1 minute at 15 EUR/h = 0.01667h * 15 = 0.25
    expect(computeExtraAmount(1, 15)).toBe(0.25);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: computeAbsenceMinutes
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeAbsenceMinutes", () => {
  it("should convert absence days to minutes using DAILY_WORK_MINUTES", () => {
    expect(computeAbsenceMinutes(1)).toBe(420); // 7h
    expect(computeAbsenceMinutes(2)).toBe(840); // 14h
    expect(computeAbsenceMinutes(5)).toBe(2100); // 35h (full week)
  });

  it("should return 0 for 0 absence days", () => {
    expect(computeAbsenceMinutes(0)).toBe(0);
  });

  it("should handle fractional absence days", () => {
    expect(computeAbsenceMinutes(0.5)).toBe(210); // half day = 3.5h
  });

  it("should handle large absence (full month ~22 working days)", () => {
    expect(computeAbsenceMinutes(22)).toBe(9240); // 22 * 420 = 154h
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: computeAbsenceAmount
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeAbsenceAmount", () => {
  it("should compute deduction for 2 absence days at standard rate", () => {
    // 2 days = 840 minutes = 14h at 15 EUR/h = 210.00
    expect(computeAbsenceAmount(840, 15)).toBe(210.0);
  });

  it("should round to 2 decimal places", () => {
    // 420 minutes at 11.538 EUR/h = 7h * 11.538 = 80.766 -> 80.77
    expect(computeAbsenceAmount(420, 11.538)).toBe(80.77);
  });

  it("should return 0 for 0 absence minutes", () => {
    expect(computeAbsenceAmount(0, 15)).toBe(0);
  });

  it("should handle rate at SMIC level", () => {
    // 1 day (420 min) at SMIC ~11.65 EUR/h = 7h * 11.65 = 81.55
    expect(computeAbsenceAmount(420, 11.65)).toBe(81.55);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12: computeTimeDeductionMinutes
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeTimeDeductionMinutes", () => {
  it("should combine late and early departure minutes", () => {
    expect(computeTimeDeductionMinutes(30, 15)).toBe(45);
  });

  it("should handle 0 late minutes", () => {
    expect(computeTimeDeductionMinutes(0, 20)).toBe(20);
  });

  it("should handle 0 early departure minutes", () => {
    expect(computeTimeDeductionMinutes(30, 0)).toBe(30);
  });

  it("should handle both 0", () => {
    expect(computeTimeDeductionMinutes(0, 0)).toBe(0);
  });

  it("should handle large values (very late employee)", () => {
    expect(computeTimeDeductionMinutes(180, 120)).toBe(300); // 5 hours total
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 13: computeTimeDeductionAmount
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeTimeDeductionAmount", () => {
  it("should convert deduction minutes to EUR", () => {
    // 45 minutes at 15 EUR/h = 0.75h * 15 = 11.25
    expect(computeTimeDeductionAmount(45, 15)).toBe(11.25);
  });

  it("should round to 2 decimal places", () => {
    // 30 minutes at 17.77 EUR/h = 0.5h * 17.77 = 8.885 -> 8.89
    expect(computeTimeDeductionAmount(30, 17.77)).toBe(8.89);
  });

  it("should return 0 for 0 deduction minutes", () => {
    expect(computeTimeDeductionAmount(0, 15)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 14: computePayrollEmployeeLine (MAIN ENGINE)
// ═══════════════════════════════════════════════════════════════════════════════

describe("computePayrollEmployeeLine", () => {
  describe("basic computation for full-time 35h employee", () => {
    it("should compute all fields correctly for a clean month (no extras, no absences)", () => {
      const input = makePayrollInputs();
      const line = computePayrollEmployeeLine(input);

      // Monthly hours: 35 * 52/12 ~= 151.667
      expect(line.monthlyHours).toBeCloseTo(151.6667, 3);

      // Hourly rate operational: 1750 / 151.667 ~= 11.538
      expect(line.hourlyRateOperational).toBeCloseTo(11.538, 2);

      // hourlyRate should equal hourlyRateOperational
      expect(line.hourlyRate).toBe(line.hourlyRateOperational);

      // Charges fixed: gross - net = 2200 - 1750 = 450
      expect(line.chargesFixed).toBe(450);
      expect(line.charges).toBe(line.chargesFixed);

      // Total salary: from contract (1750 when total_salary = 1750)
      expect(line.totalSalary).toBe(1750);

      // Cash: totalSalary - net = 1750 - 1750 = 0
      expect(line.cashAmountComputed).toBe(0);

      // No extras
      expect(line.extraMinutes).toBe(0);
      expect(line.extraAmount).toBe(0);
      expect(line.planningExtraMinutesMonth).toBe(0);
      expect(line.totalExtraMinutesMonth).toBe(0);
      expect(line.totalExtraAmount).toBe(0);

      // No CP
      expect(line.cpDays).toBe(0);
      expect(line.cpMinutes).toBe(0);

      // No absences
      expect(line.absenceDeclaredDays).toBe(0);
      expect(line.absenceBadgeDays).toBe(0);
      expect(line.absenceDaysTotal).toBe(0);
      expect(line.absenceMinutes).toBe(0);
      expect(line.absenceAmount).toBe(0);

      // No time deductions
      expect(line.lateMinutesTotal).toBe(0);
      expect(line.earlyDepartureMinutesTotal).toBe(0);
      expect(line.timeDeductionMinutes).toBe(0);
      expect(line.timeDeductionAmount).toBe(0);

      // Original contract values
      expect(line.gross_salary).toBe(2200);
      expect(line.net_salary).toBe(1750);

      // Base minutes: round(151.667 * 60) = round(9100) = 9100
      expect(line.baseMinutesMonth).toBe(Math.round(151.6667 * 60));
    });
  });

  describe("employee with cash component (total_salary > net_salary)", () => {
    it("should compute cashAmountComputed correctly", () => {
      const input = makePayrollInputs({
        contract: makeContract39h({ total_salary: 2800 }), // net=2400, total=2800 -> cash=400
      });
      const line = computePayrollEmployeeLine(input);

      expect(line.totalSalary).toBe(2800);
      expect(line.cashAmountComputed).toBe(400); // 2800 - 2400

      // Operational rate uses total_salary
      expect(line.hourlyRateOperational).toBeCloseTo(2800 / 169, 4);
    });

    it("should use net_salary as totalSalary when total_salary is null", () => {
      const input = makePayrollInputs({
        contract: makeContract35h({ total_salary: null }),
      });
      const line = computePayrollEmployeeLine(input);

      expect(line.totalSalary).toBe(1750); // fallback to net_salary
      expect(line.cashAmountComputed).toBe(0);
    });
  });

  describe("badge extras", () => {
    it("should only count approved extra events", () => {
      const input = makePayrollInputs({
        extraEvents: [
          { extra_minutes: 120, status: "approved" },
          { extra_minutes: 60, status: "pending" },
          { extra_minutes: 45, status: "rejected" },
          { extra_minutes: 30, status: "approved" },
        ],
      });
      const line = computePayrollEmployeeLine(input);

      expect(line.extraMinutes).toBe(150); // 120 + 30
      expect(line.extraAmount).toBe(roundCurrency((150 / 60) * line.hourlyRateOperational));
    });
  });

  describe("planning extras (weekly calculation)", () => {
    it("should use weekly calculation when shiftsRaw + targetMonth provided", () => {
      const input = makePayrollInputs({
        contract: makeContract35h(),
        // Week: Mon 2026-01-05 -> Sun 2026-01-11, 40h worked
        shiftsRaw: [
          { shift_date: "2026-01-05", net_minutes: 480 },
          { shift_date: "2026-01-06", net_minutes: 480 },
          { shift_date: "2026-01-07", net_minutes: 480 },
          { shift_date: "2026-01-08", net_minutes: 480 },
          { shift_date: "2026-01-09", net_minutes: 480 }, // 5 * 8h = 40h
        ],
        targetMonth: "2026-01",
        workedMinutesMonth: 2400, // 40h - should NOT be used for extras
      });
      const line = computePayrollEmployeeLine(input);

      // 40h - 35h = 5h = 300 min
      expect(line.planningExtraMinutesMonth).toBe(300);
    });

    it("should fallback to monthly formula when no shiftsRaw", () => {
      const input = makePayrollInputs({
        workedMinutesMonth: 10000, // higher than baseMinutesMonth
      });
      const line = computePayrollEmployeeLine(input);

      // Fallback: max(0, workedMinutesMonth - baseMinutesMonth)
      const expectedBase = Math.round(computeMonthlyHours(35) * 60);
      expect(line.planningExtraMinutesMonth).toBe(Math.max(0, 10000 - expectedBase));
    });

    it("should fallback to 0 when workedMinutes < baseMinutes and no shiftsRaw", () => {
      const input = makePayrollInputs({
        workedMinutesMonth: 5000, // less than baseMinutesMonth
      });
      const line = computePayrollEmployeeLine(input);

      expect(line.planningExtraMinutesMonth).toBe(0);
    });
  });

  describe("totalExtraMinutesMonth (badge + planning)", () => {
    it("should sum badge extras and planning extras", () => {
      const input = makePayrollInputs({
        extraEvents: [{ extra_minutes: 60, status: "approved" }],
        shiftsRaw: [
          // Week: Mon 2026-01-05 -> Sun 2026-01-11, 38h = 3h extra
          { shift_date: "2026-01-05", net_minutes: 456 },
          { shift_date: "2026-01-06", net_minutes: 456 },
          { shift_date: "2026-01-07", net_minutes: 456 },
          { shift_date: "2026-01-08", net_minutes: 456 },
          { shift_date: "2026-01-09", net_minutes: 456 },
        ],
        targetMonth: "2026-01",
        workedMinutesMonth: 2280,
      });
      const line = computePayrollEmployeeLine(input);

      expect(line.extraMinutes).toBe(60); // badge
      expect(line.planningExtraMinutesMonth).toBe(180); // planning: 38h-35h = 3h
      expect(line.totalExtraMinutesMonth).toBe(240); // 60 + 180
      expect(line.totalExtraAmount).toBe(roundCurrency((240 / 60) * line.hourlyRateOperational));
    });
  });

  describe("CP (conges payes) - counted but NOT deducted from salary", () => {
    it("should count CP days/minutes but not generate a deduction amount", () => {
      const input = makePayrollInputs({
        cpDays: 5,
      });
      const line = computePayrollEmployeeLine(input);

      expect(line.cpDays).toBe(5);
      expect(line.cpMinutes).toBe(5 * 420); // 5 * 7h = 2100 min

      // CP should NOT affect absence deductions
      expect(line.absenceAmount).toBe(0);
      expect(line.absenceDaysTotal).toBe(0);
    });

    it("should keep CP separate from absences when both exist", () => {
      const input = makePayrollInputs({
        cpDays: 3,
        absenceDeclaredDays: 2,
      });
      const line = computePayrollEmployeeLine(input);

      expect(line.cpDays).toBe(3);
      expect(line.cpMinutes).toBe(3 * 420);

      // Only absence days generate deductions, not CP
      expect(line.absenceDaysTotal).toBe(2);
      expect(line.absenceMinutes).toBe(2 * 420);
      expect(line.absenceAmount).toBeGreaterThan(0);
    });
  });

  describe("absences (declared + badge)", () => {
    it("should sum declared and badge absence days", () => {
      const input = makePayrollInputs({
        absenceDeclaredDays: 3,
        absenceBadgeDays: 1,
      });
      const line = computePayrollEmployeeLine(input);

      expect(line.absenceDeclaredDays).toBe(3);
      expect(line.absenceBadgeDays).toBe(1);
      expect(line.absenceDaysTotal).toBe(4);
      expect(line.absenceMinutes).toBe(4 * 420); // 4 * 7h
    });

    it("should calculate absence deduction using hourlyRateOperational", () => {
      const input = makePayrollInputs({
        absenceDeclaredDays: 2,
      });
      const line = computePayrollEmployeeLine(input);

      const expectedMinutes = 2 * DAILY_WORK_MINUTES;
      const expectedAmount = roundCurrency((expectedMinutes / 60) * line.hourlyRateOperational);
      expect(line.absenceAmount).toBe(expectedAmount);
    });

    it("should handle 0 absences", () => {
      const input = makePayrollInputs({
        absenceDeclaredDays: 0,
        absenceBadgeDays: 0,
      });
      const line = computePayrollEmployeeLine(input);

      expect(line.absenceDaysTotal).toBe(0);
      expect(line.absenceAmount).toBe(0);
    });
  });

  describe("time deductions (late + early departure)", () => {
    it("should combine late and early departure deductions", () => {
      const input = makePayrollInputs({
        lateMinutesTotal: 30,
        earlyDepartureMinutesTotal: 15,
      });
      const line = computePayrollEmployeeLine(input);

      expect(line.lateMinutesTotal).toBe(30);
      expect(line.earlyDepartureMinutesTotal).toBe(15);
      expect(line.timeDeductionMinutes).toBe(45);

      const expectedAmount = roundCurrency((45 / 60) * line.hourlyRateOperational);
      expect(line.timeDeductionAmount).toBe(expectedAmount);
    });
  });

  describe("full realistic scenario (39h contract, all events)", () => {
    it("should compute a complete payroll line for a complex month", () => {
      const input = makePayrollInputs({
        contract: makeContract39h({ total_salary: 2800 }), // cash=400
        extraEvents: [
          { extra_minutes: 120, status: "approved" },
          { extra_minutes: 60, status: "pending" }, // ignored
        ],
        cpDays: 2,
        absenceDeclaredDays: 1,
        absenceBadgeDays: 1,
        lateMinutesTotal: 45,
        earlyDepartureMinutesTotal: 20,
        workedMinutesMonth: 10500,
        shiftsRaw: [
          // Week 1: Mon Jan 5 -> Sun Jan 11 (42h worked)
          { shift_date: "2026-01-05", net_minutes: 504 },
          { shift_date: "2026-01-06", net_minutes: 504 },
          { shift_date: "2026-01-07", net_minutes: 504 },
          { shift_date: "2026-01-08", net_minutes: 504 },
          { shift_date: "2026-01-09", net_minutes: 504 },
          // Week 2: Mon Jan 12 -> Sun Jan 18 (39h worked, no extras)
          { shift_date: "2026-01-12", net_minutes: 468 },
          { shift_date: "2026-01-13", net_minutes: 468 },
          { shift_date: "2026-01-14", net_minutes: 468 },
          { shift_date: "2026-01-15", net_minutes: 468 },
          { shift_date: "2026-01-16", net_minutes: 468 },
        ],
        targetMonth: "2026-01",
      });
      const line = computePayrollEmployeeLine(input);

      // Monthly hours: 39 * 52/12 = 169
      expect(line.monthlyHours).toBe(169);

      // Total salary: 2800
      expect(line.totalSalary).toBe(2800);
      expect(line.cashAmountComputed).toBe(400);

      // Hourly rate operational: 2800/169 ~= 16.568
      expect(line.hourlyRateOperational).toBeCloseTo(2800 / 169, 4);

      // Charges fixed: 3000 - 2400 = 600
      expect(line.chargesFixed).toBe(600);

      // Badge extras: only approved 120 min
      expect(line.extraMinutes).toBe(120);

      // Planning extras: week1=42h->3h extra=180min, week2=39h->0
      expect(line.planningExtraMinutesMonth).toBe(180);

      // Total extras
      expect(line.totalExtraMinutesMonth).toBe(300); // 120 + 180

      // CP
      expect(line.cpDays).toBe(2);
      expect(line.cpMinutes).toBe(840);

      // Absences
      expect(line.absenceDaysTotal).toBe(2); // 1 declared + 1 badge
      expect(line.absenceMinutes).toBe(840);

      // Time deductions
      expect(line.timeDeductionMinutes).toBe(65); // 45 + 20
    });
  });

  describe("edge case: employee with 0 contract hours", () => {
    it("should handle gracefully with 0 monthly hours", () => {
      const input = makePayrollInputs({
        contract: makeContract35h({ contract_hours: 0 }),
      });
      const line = computePayrollEmployeeLine(input);

      expect(line.monthlyHours).toBe(0);
      expect(line.hourlyRateOperational).toBe(0);
      expect(line.extraAmount).toBe(0);
      expect(line.absenceAmount).toBe(0);
      expect(line.timeDeductionAmount).toBe(0);
    });
  });

  describe("CP balance fields", () => {
    it("should pass through contract CP values and leave remaining undefined when no cpBalances provided", () => {
      const input = makePayrollInputs();
      const line = computePayrollEmployeeLine(input);

      // cpN1/cpN come from contract (10 and 5 in makeContract35h)
      expect(line.cpN1).toBe(10);
      expect(line.cpN).toBe(5);
      // cpRemainingN1/cpRemainingN are undefined when cpBalances not provided
      expect(line.cpRemainingN1).toBeUndefined();
      expect(line.cpRemainingN).toBeUndefined();
    });

    it("should use cpBalances when provided", () => {
      const input = makePayrollInputs({
        cpBalances: { cpRemainingN1: 8, cpRemainingN: 3 },
      });
      const line = computePayrollEmployeeLine(input);

      expect(line.cpN1).toBe(10);
      expect(line.cpN).toBe(5);
      expect(line.cpRemainingN1).toBe(8);
      expect(line.cpRemainingN).toBe(3);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 15: computeAdjustedGross (deprecated)
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeAdjustedGross (deprecated)", () => {
  it("should compute totalSalary + extras - absences - deductions", () => {
    const input = makePayrollInputs({
      contract: makeContract39h({ total_salary: 2800 }),
      extraEvents: [{ extra_minutes: 120, status: "approved" }],
      absenceDeclaredDays: 1,
      lateMinutesTotal: 30,
      earlyDepartureMinutesTotal: 15,
      workedMinutesMonth: 0,
    });
    const line = computePayrollEmployeeLine(input);
    const adjusted = computeAdjustedGross(line);

    expect(adjusted).toBe(
      line.totalSalary + line.totalExtraAmount - line.absenceAmount - line.timeDeductionAmount
    );
  });

  it("should equal totalSalary when no adjustments", () => {
    const input = makePayrollInputs();
    const line = computePayrollEmployeeLine(input);
    const adjusted = computeAdjustedGross(line);

    expect(adjusted).toBe(line.totalSalary);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 16: computeAdjustedTotalSalary (PHASE 2)
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeAdjustedTotalSalary", () => {
  let line: PayrollEmployeeLine;

  beforeEach(() => {
    const input = makePayrollInputs({
      contract: makeContract39h({ total_salary: 2800 }),
      extraEvents: [{ extra_minutes: 120, status: "approved" }],
      absenceDeclaredDays: 2,
      lateMinutesTotal: 60,
      earlyDepartureMinutesTotal: 30,
      workedMinutesMonth: 10000,
    });
    line = computePayrollEmployeeLine(input);
  });

  it("should return totalSalary unchanged when no flags provided", () => {
    const adjusted = computeAdjustedTotalSalary(line);
    expect(adjusted).toBe(line.totalSalary);
  });

  it("should return totalSalary unchanged when flags are all false", () => {
    const adjusted = computeAdjustedTotalSalary(line, {
      ...DEFAULT_VALIDATION_FLAGS,
    });
    expect(adjusted).toBe(line.totalSalary);
  });

  it("should add extras when includeExtras is true", () => {
    const adjusted = computeAdjustedTotalSalary(line, {
      ...DEFAULT_VALIDATION_FLAGS,
      includeExtras: true,
    });
    expect(adjusted).toBe(line.totalSalary + line.totalExtraAmount);
  });

  it("should subtract absences when includeAbsences is true", () => {
    const adjusted = computeAdjustedTotalSalary(line, {
      ...DEFAULT_VALIDATION_FLAGS,
      includeAbsences: true,
    });
    expect(adjusted).toBe(line.totalSalary - line.absenceAmount);
  });

  it("should subtract deductions when includeDeductions is true", () => {
    const adjusted = computeAdjustedTotalSalary(line, {
      ...DEFAULT_VALIDATION_FLAGS,
      includeDeductions: true,
    });
    expect(adjusted).toBe(line.totalSalary - line.timeDeductionAmount);
  });

  it("should combine all adjustments when all flags are true", () => {
    const adjusted = computeAdjustedTotalSalary(line, {
      ...DEFAULT_VALIDATION_FLAGS,
      includeExtras: true,
      includeAbsences: true,
      includeDeductions: true,
    });
    expect(adjusted).toBe(
      line.totalSalary + line.totalExtraAmount - line.absenceAmount - line.timeDeductionAmount
    );
  });
});

describe("computeAdjustedGrossValidated (deprecated)", () => {
  it("should delegate to computeAdjustedTotalSalary", () => {
    const input = makePayrollInputs({
      contract: makeContract39h({ total_salary: 2800 }),
      extraEvents: [{ extra_minutes: 60, status: "approved" }],
      absenceDeclaredDays: 1,
      workedMinutesMonth: 0,
    });
    const line = computePayrollEmployeeLine(input);
    const flags: PayrollValidationFlags = {
      ...DEFAULT_VALIDATION_FLAGS,
      includeExtras: true,
      includeAbsences: true,
    };

    expect(computeAdjustedGrossValidated(line, flags)).toBe(
      computeAdjustedTotalSalary(line, flags)
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 17: computeDueBreakdownSimplified
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeDueBreakdownSimplified", () => {
  let line: PayrollEmployeeLine;

  beforeEach(() => {
    const input = makePayrollInputs({
      contract: makeContract39h({ total_salary: 2800 }),
      extraEvents: [{ extra_minutes: 120, status: "approved" }],
      absenceDeclaredDays: 2,
      lateMinutesTotal: 60,
      earlyDepartureMinutesTotal: 30,
      workedMinutesMonth: 10000,
    });
    line = computePayrollEmployeeLine(input);
  });

  it("should return raw amounts regardless of flags", () => {
    const breakdown = computeDueBreakdownSimplified(line, undefined);

    expect(breakdown.extrasMinutesRaw).toBe(line.totalExtraMinutesMonth);
    expect(breakdown.extrasAmountRaw).toBe(line.totalExtraAmount);
    expect(breakdown.deductionMinutesRaw).toBe(line.timeDeductionMinutes);
    expect(breakdown.deductionAmountRaw).toBe(line.timeDeductionAmount);
    expect(breakdown.absencesAmountRaw).toBe(line.absenceAmount);
  });

  it("should apply no amounts when no flags provided", () => {
    const breakdown = computeDueBreakdownSimplified(line, undefined);

    expect(breakdown.extrasAmountForPay).toBe(0);
    expect(breakdown.deductionAmountForPay).toBe(0);
    expect(breakdown.absencesAmountForPay).toBe(0);
    expect(breakdown.adjustedGross).toBe(line.totalSalary);
  });

  it("should apply all amounts when all flags true", () => {
    const flags: PayrollValidationFlags = {
      ...DEFAULT_VALIDATION_FLAGS,
      includeExtras: true,
      includeAbsences: true,
      includeDeductions: true,
    };
    const breakdown = computeDueBreakdownSimplified(line, flags);

    expect(breakdown.extrasAmountForPay).toBe(line.totalExtraAmount);
    expect(breakdown.deductionAmountForPay).toBe(line.timeDeductionAmount);
    expect(breakdown.absencesAmountForPay).toBe(line.absenceAmount);
    expect(breakdown.adjustedGross).toBe(
      roundCurrency(
        line.totalSalary + line.totalExtraAmount - line.absenceAmount - line.timeDeductionAmount
      )
    );
  });

  describe("partial extras payment (extrasPaidEur)", () => {
    it("should use extrasPaidEur when includeExtras is true and extrasPaidEur is set", () => {
      const partialPay = 15; // Must be <= line.totalExtraAmount to avoid clamping
      const flags: PayrollValidationFlags = {
        ...DEFAULT_VALIDATION_FLAGS,
        includeExtras: true,
        extrasPaidEur: partialPay,
      };
      const breakdown = computeDueBreakdownSimplified(line, flags);

      // Should use partialPay EUR (partial payment), not full amount
      expect(breakdown.extrasAmountForPay).toBe(partialPay);
      expect(breakdown.adjustedGross).toBe(roundCurrency(line.totalSalary + partialPay));
    });

    it("should clamp extrasPaidEur to [0, extrasAmountRaw]", () => {
      const flags: PayrollValidationFlags = {
        ...DEFAULT_VALIDATION_FLAGS,
        includeExtras: true,
        extrasPaidEur: 999999, // way more than actual extras
      };
      const breakdown = computeDueBreakdownSimplified(line, flags);

      // Should be clamped to the raw amount
      expect(breakdown.extrasAmountForPay).toBe(line.totalExtraAmount);
    });

    it("should clamp negative extrasPaidEur to 0", () => {
      const flags: PayrollValidationFlags = {
        ...DEFAULT_VALIDATION_FLAGS,
        includeExtras: true,
        extrasPaidEur: -100,
      };
      const breakdown = computeDueBreakdownSimplified(line, flags);

      expect(breakdown.extrasAmountForPay).toBe(0);
    });

    it("should use full amount when extrasPaidEur is null (default behavior)", () => {
      const flags: PayrollValidationFlags = {
        ...DEFAULT_VALIDATION_FLAGS,
        includeExtras: true,
        extrasPaidEur: null,
      };
      const breakdown = computeDueBreakdownSimplified(line, flags);

      expect(breakdown.extrasAmountForPay).toBe(line.totalExtraAmount);
    });

    it("should not apply extras when includeExtras is false even if extrasPaidEur is set", () => {
      const flags: PayrollValidationFlags = {
        ...DEFAULT_VALIDATION_FLAGS,
        includeExtras: false,
        extrasPaidEur: 50,
      };
      const breakdown = computeDueBreakdownSimplified(line, flags);

      expect(breakdown.extrasAmountForPay).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 18: computeRExtraDecision
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeRExtraDecision", () => {
  let line: PayrollEmployeeLine;

  beforeEach(() => {
    const input = makePayrollInputs({
      contract: makeContract39h({ total_salary: 2800 }),
      extraEvents: [{ extra_minutes: 120, status: "approved" }],
      shiftsRaw: [
        // Week: 42h worked = 3h extras
        { shift_date: "2026-01-05", net_minutes: 504 },
        { shift_date: "2026-01-06", net_minutes: 504 },
        { shift_date: "2026-01-07", net_minutes: 504 },
        { shift_date: "2026-01-08", net_minutes: 504 },
        { shift_date: "2026-01-09", net_minutes: 504 },
      ],
      targetMonth: "2026-01",
      workedMinutesMonth: 2520,
    });
    line = computePayrollEmployeeLine(input);
  });

  it("should compute detected minutes from line.totalExtraMinutesMonth", () => {
    const decision = computeRExtraDecision(line, null);

    expect(decision.detectedMinutes).toBe(line.totalExtraMinutesMonth);
    expect(decision.detectedEur).toBe(line.totalExtraAmount);
  });

  it("should set totalAvailable equal to detected (no carryIn)", () => {
    const decision = computeRExtraDecision(line, null);

    expect(decision.totalAvailableMinutes).toBe(decision.detectedMinutes);
    expect(decision.totalAvailableEur).toBe(decision.detectedEur);
  });

  it("should set paidEur to 0 when inputPaidEur is null", () => {
    const decision = computeRExtraDecision(line, null);

    expect(decision.paidEur).toBe(0);
    expect(decision.paidMinutes).toBe(0);
  });

  it("should set paidEur to 0 when inputPaidEur is undefined", () => {
    const decision = computeRExtraDecision(line, undefined);

    expect(decision.paidEur).toBe(0);
  });

  it("should clamp paidEur to totalAvailableEur", () => {
    const decision = computeRExtraDecision(line, 999999);

    expect(decision.paidEur).toBe(decision.totalAvailableEur);
  });

  it("should clamp negative paidEur to 0", () => {
    const decision = computeRExtraDecision(line, -100);

    expect(decision.paidEur).toBe(0);
  });

  it("should compute R-Extra as available - paid", () => {
    const partialPay = 50;
    const decision = computeRExtraDecision(line, partialPay);

    expect(decision.paidEur).toBe(partialPay);
    // rExtraMinutes = totalAvailable - paidMinutes
    expect(decision.rExtraMinutes).toBeGreaterThan(0);
    expect(decision.rExtraMinutes).toBe(
      Math.max(0, decision.totalAvailableMinutes - decision.paidMinutes)
    );
  });

  it("should have rExtraMinutes = totalAvailableMinutes when nothing paid", () => {
    const decision = computeRExtraDecision(line, 0);

    expect(decision.rExtraMinutes).toBe(decision.totalAvailableMinutes);
    expect(decision.rExtraEur).toBe(decision.totalAvailableEur);
  });

  it("should have rExtraMinutes = 0 when everything paid", () => {
    const decision = computeRExtraDecision(line, line.totalExtraAmount);

    expect(decision.paidEur).toBe(line.totalExtraAmount);
    // When paid == detected, rExtra should be 0 or very close to 0
    // due to EUR->minutes->EUR rounding, rExtraMinutes could be 0
    expect(decision.rExtraMinutes).toBeLessThanOrEqual(1); // allow 1 min rounding
  });

  it("should handle 0 hourly rate gracefully", () => {
    const zeroLine: PayrollEmployeeLine = {
      ...line,
      hourlyRateOperational: 0,
      totalExtraMinutesMonth: 120,
      totalExtraAmount: 0,
    };
    const decision = computeRExtraDecision(zeroLine, 50);

    expect(decision.paidEur).toBe(0); // clamped to totalAvailableEur=0
    expect(decision.paidMinutes).toBe(0); // can't convert EUR to minutes with rate=0
    expect(decision.rExtraEur).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 19: computePayrollTotalsFromEmployees
// ═══════════════════════════════════════════════════════════════════════════════

describe("computePayrollTotalsFromEmployees", () => {
  function makeEmployeeForTotals(
    userId: string,
    contractOverrides?: Partial<EmployeeContract>,
    inputOverrides?: Partial<PayrollEmployeeInputs>
  ): PayrollEmployeeForTotals {
    const input = makePayrollInputs({
      contract: makeContract39h(contractOverrides),
      ...inputOverrides,
    });
    return {
      userId,
      line: computePayrollEmployeeLine(input),
    };
  }

  it("should compute totals for a single employee with no adjustments", () => {
    const employee = makeEmployeeForTotals("user-1");
    const totals = computePayrollTotalsFromEmployees([employee]);

    expect(totals.totalGrossBase).toBe(3000);
    expect(totals.totalNetBase).toBe(2400);
    expect(totals.totalExtras).toBe(0);
    expect(totals.totalCpDays).toBe(0);
    expect(totals.totalAbsences).toBe(0);
    expect(totals.totalDeductions).toBe(0);
    expect(totals.totalChargesFixed).toBe(600); // 3000 - 2400
  });

  it("should sum across multiple employees", () => {
    const emp1 = makeEmployeeForTotals("user-1", { gross_salary: 3000, net_salary: 2400 });
    const emp2 = makeEmployeeForTotals("user-2", { gross_salary: 2500, net_salary: 2000 });
    const totals = computePayrollTotalsFromEmployees([emp1, emp2]);

    expect(totals.totalGrossBase).toBe(5500);
    expect(totals.totalNetBase).toBe(4400);
    expect(totals.totalChargesFixed).toBe(1100); // 600 + 500
  });

  it("should compute totalMassToDisburse = sum of totalSalary when no validation flags", () => {
    const emp1 = makeEmployeeForTotals("user-1");
    const emp2 = makeEmployeeForTotals("user-2");
    const totals = computePayrollTotalsFromEmployees([emp1, emp2]);

    // Without flags, adjustedTotalSalary = totalSalary for each
    expect(totals.totalMassToDisburse).toBe(emp1.line.totalSalary + emp2.line.totalSalary);
  });

  it("should apply validation flags per employee", () => {
    const emp1 = makeEmployeeForTotals("user-1", undefined, {
      extraEvents: [{ extra_minutes: 120, status: "approved" }],
      absenceDeclaredDays: 1,
      workedMinutesMonth: 0,
    });
    const emp2 = makeEmployeeForTotals("user-2", undefined, {
      lateMinutesTotal: 60,
      workedMinutesMonth: 0,
    });

    const validationMap = new Map<string, PayrollValidationFlags>([
      ["user-1", { ...DEFAULT_VALIDATION_FLAGS, includeExtras: true, includeAbsences: true }],
      ["user-2", { ...DEFAULT_VALIDATION_FLAGS, includeDeductions: true }],
    ]);

    const totals = computePayrollTotalsFromEmployees([emp1, emp2], validationMap);

    // emp1: totalSalary + extras - absences
    const emp1Adjusted =
      emp1.line.totalSalary + emp1.line.totalExtraAmount - emp1.line.absenceAmount;
    // emp2: totalSalary - deductions
    const emp2Adjusted = emp2.line.totalSalary - emp2.line.timeDeductionAmount;

    expect(totals.totalMassToDisburse).toBeCloseTo(emp1Adjusted + emp2Adjusted, 2);
  });

  it("should compute totalPayrollMass = totalMassToDisburse + totalChargesFixed", () => {
    const emp1 = makeEmployeeForTotals("user-1");
    const totals = computePayrollTotalsFromEmployees([emp1]);

    expect(totals.totalPayrollMass).toBe(totals.totalMassToDisburse + totals.totalChargesFixed);
  });

  it("should handle empty employee list", () => {
    const totals = computePayrollTotalsFromEmployees([]);

    expect(totals.totalGrossBase).toBe(0);
    expect(totals.totalNetBase).toBe(0);
    expect(totals.totalExtras).toBe(0);
    expect(totals.totalCpDays).toBe(0);
    expect(totals.totalAbsences).toBe(0);
    expect(totals.totalDeductions).toBe(0);
    expect(totals.totalMassToDisburse).toBe(0);
    expect(totals.totalChargesFixed).toBe(0);
    expect(totals.totalPayrollMass).toBe(0);
    expect(totals.totalCashAmount).toBe(0);
  });

  it("should sum totalCashAmount for display purposes", () => {
    const emp1 = makeEmployeeForTotals("user-1", { total_salary: 2800 }); // cash=400
    const emp2 = makeEmployeeForTotals("user-2", { total_salary: 2600 }); // cash=200
    const totals = computePayrollTotalsFromEmployees([emp1, emp2]);

    expect(totals.totalCashAmount).toBe(
      emp1.line.cashAmountComputed + emp2.line.cashAmountComputed
    );
  });

  describe("deprecated fields backward compatibility", () => {
    it("should set deprecated fields correctly", () => {
      const emp1 = makeEmployeeForTotals("user-1", undefined, {
        extraEvents: [{ extra_minutes: 60, status: "approved" }],
        absenceDeclaredDays: 1,
        workedMinutesMonth: 0,
      });
      const totals = computePayrollTotalsFromEmployees([emp1]);

      // totalGrossAdjusted = grossBase + extras - absences - deductions
      expect(totals.totalGrossAdjusted).toBe(
        totals.totalGrossBase + totals.totalExtras - totals.totalAbsences - totals.totalDeductions
      );

      // remainingToPay = grossBase - netBase
      expect(totals.remainingToPay).toBe(totals.totalGrossBase - totals.totalNetBase);

      // totalGrossAdjustedValidated = totalMassToDisburse
      expect(totals.totalGrossAdjustedValidated).toBe(totals.totalMassToDisburse);

      // totalGrossDisplayed = totalMassToDisburse
      expect(totals.totalGrossDisplayed).toBe(totals.totalMassToDisburse);

      // remainingToPayDisplayed = totalChargesFixed
      expect(totals.remainingToPayDisplayed).toBe(totals.totalChargesFixed);

      // totalNetWithCash = totalMassToDisburse
      expect(totals.totalNetWithCash).toBe(totals.totalMassToDisburse);

      // totalGrossWithCash = totalPayrollMass
      expect(totals.totalGrossWithCash).toBe(totals.totalPayrollMass);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 20: sumLateMinutes
// ═══════════════════════════════════════════════════════════════════════════════

describe("sumLateMinutes", () => {
  it("should sum late_minutes from events", () => {
    const events = [{ late_minutes: 10 }, { late_minutes: 5 }, { late_minutes: 15 }];
    expect(sumLateMinutes(events)).toBe(30);
  });

  it("should handle null late_minutes as 0", () => {
    const events = [{ late_minutes: 10 }, { late_minutes: null }, { late_minutes: 5 }];
    expect(sumLateMinutes(events)).toBe(15);
  });

  it("should return 0 for empty array", () => {
    expect(sumLateMinutes([])).toBe(0);
  });

  it("should handle all null values", () => {
    const events = [{ late_minutes: null }, { late_minutes: null }];
    expect(sumLateMinutes(events)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 21: sumEarlyDepartureMinutes
// ═══════════════════════════════════════════════════════════════════════════════

describe("sumEarlyDepartureMinutes", () => {
  it("should sum array of minutes", () => {
    expect(sumEarlyDepartureMinutes([10, 20, 30])).toBe(60);
  });

  it("should return 0 for empty array", () => {
    expect(sumEarlyDepartureMinutes([])).toBe(0);
  });

  it("should handle single element", () => {
    expect(sumEarlyDepartureMinutes([45])).toBe(45);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 22: computeHeuresARetirer
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeHeuresARetirer", () => {
  it("should combine late and early departure with formatted output", () => {
    const result = computeHeuresARetirer(30, 15);
    expect(result.totalMinutes).toBe(45);
    expect(result.hhmm).toBe("00:45");
  });

  it("should handle large values", () => {
    const result = computeHeuresARetirer(120, 60);
    expect(result.totalMinutes).toBe(180);
    expect(result.hhmm).toBe("03:00");
  });

  it("should return 00:00 for both 0", () => {
    const result = computeHeuresARetirer(0, 0);
    expect(result.totalMinutes).toBe(0);
    expect(result.hhmm).toBe("00:00");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 23: formatMinutesToHHMM
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatMinutesToHHMM", () => {
  it("should format 0 minutes", () => {
    expect(formatMinutesToHHMM(0)).toBe("00:00");
  });

  it("should format sub-hour minutes", () => {
    expect(formatMinutesToHHMM(45)).toBe("00:45");
  });

  it("should format exact hours", () => {
    expect(formatMinutesToHHMM(60)).toBe("01:00");
    expect(formatMinutesToHHMM(120)).toBe("02:00");
  });

  it("should format hours and minutes", () => {
    expect(formatMinutesToHHMM(90)).toBe("01:30");
    expect(formatMinutesToHHMM(150)).toBe("02:30");
  });

  it("should pad single digits", () => {
    expect(formatMinutesToHHMM(5)).toBe("00:05");
    expect(formatMinutesToHHMM(65)).toBe("01:05");
  });

  it("should handle large values (24+ hours)", () => {
    expect(formatMinutesToHHMM(1500)).toBe("25:00"); // 25 hours
  });

  it("should return 00:00 for negative values", () => {
    expect(formatMinutesToHHMM(-10)).toBe("00:00");
  });

  it("should return 00:00 for NaN", () => {
    expect(formatMinutesToHHMM(NaN)).toBe("00:00");
  });

  it("should return 00:00 for Infinity", () => {
    expect(formatMinutesToHHMM(Infinity)).toBe("00:00");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 24: countCpDays
// ═══════════════════════════════════════════════════════════════════════════════

describe("countCpDays", () => {
  it("should count approved CP leaves only", () => {
    const leaves = [
      { leave_date: "2026-01-10", leave_type: "cp", status: "approved" },
      { leave_date: "2026-01-11", leave_type: "cp", status: "approved" },
      { leave_date: "2026-01-12", leave_type: "absence", status: "approved" }, // not CP
      { leave_date: "2026-01-13", leave_type: "cp", status: "rejected" }, // rejected
    ];
    expect(countCpDays(leaves)).toBe(2);
  });

  it("should deduplicate same-date leaves", () => {
    const leaves = [
      { leave_date: "2026-01-10", leave_type: "cp", status: "approved" },
      { leave_date: "2026-01-10", leave_type: "cp", status: "approved" }, // duplicate
    ];
    expect(countCpDays(leaves)).toBe(1);
  });

  it("should return 0 for empty array", () => {
    expect(countCpDays([])).toBe(0);
  });

  it("should return 0 when no CP leaves exist", () => {
    const leaves = [
      { leave_date: "2026-01-10", leave_type: "absence", status: "approved" },
      { leave_date: "2026-01-11", leave_type: "repos", status: "approved" },
    ];
    expect(countCpDays(leaves)).toBe(0);
  });

  it("should treat undefined status as approved (backward compat)", () => {
    const leaves = [
      { leave_date: "2026-01-10", leave_type: "cp" },
      { leave_date: "2026-01-11", leave_type: "cp" },
    ];
    expect(countCpDays(leaves)).toBe(2);
  });

  it("should reject pending CP leaves", () => {
    const leaves = [{ leave_date: "2026-01-10", leave_type: "cp", status: "pending" }];
    expect(countCpDays(leaves)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 25: countAbsenceDays
// ═══════════════════════════════════════════════════════════════════════════════

describe("countAbsenceDays", () => {
  it("should count approved absence leaves only (not CP, not repos)", () => {
    const leaves = [
      { leave_date: "2026-01-10", leave_type: "cp", status: "approved" }, // not absence
      { leave_date: "2026-01-11", leave_type: "absence", status: "approved" },
      { leave_date: "2026-01-12", leave_type: "repos", status: "approved" }, // not absence
      { leave_date: "2026-01-13", leave_type: "absence", status: "approved" },
    ];
    expect(countAbsenceDays(leaves)).toBe(2);
  });

  it("should deduplicate same-date leaves", () => {
    const leaves = [
      { leave_date: "2026-01-10", leave_type: "absence", status: "approved" },
      { leave_date: "2026-01-10", leave_type: "absence", status: "approved" }, // duplicate
    ];
    expect(countAbsenceDays(leaves)).toBe(1);
  });

  it("should return 0 for empty array", () => {
    expect(countAbsenceDays([])).toBe(0);
  });

  it("should treat undefined status as approved", () => {
    const leaves = [{ leave_date: "2026-01-10", leave_type: "absence" }];
    expect(countAbsenceDays(leaves)).toBe(1);
  });

  it("should reject non-approved absence leaves", () => {
    const leaves = [
      { leave_date: "2026-01-10", leave_type: "absence", status: "pending" },
      { leave_date: "2026-01-11", leave_type: "absence", status: "rejected" },
    ];
    expect(countAbsenceDays(leaves)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 26: computePlanningPayrollCost
// ═══════════════════════════════════════════════════════════════════════════════

describe("computePlanningPayrollCost", () => {
  it("should compute cost from net minutes and hourly rate", () => {
    // 2100 minutes (35h) at 15 EUR/h = 35 * 15 = 525.00
    expect(computePlanningPayrollCost(2100, 15)).toBe(525.0);
  });

  it("should round to 2 decimal places", () => {
    // 100 minutes at 17.77 EUR/h = 1.6667h * 17.77 = 29.6111... -> 29.61
    expect(computePlanningPayrollCost(100, 17.77)).toBe(29.62);
  });

  it("should return 0 for 0 net minutes", () => {
    expect(computePlanningPayrollCost(0, 15)).toBe(0);
  });

  it("should return 0 for negative net minutes", () => {
    expect(computePlanningPayrollCost(-100, 15)).toBe(0);
  });

  it("should return 0 for 0 hourly rate", () => {
    expect(computePlanningPayrollCost(2100, 0)).toBe(0);
  });

  it("should return 0 for negative hourly rate", () => {
    expect(computePlanningPayrollCost(2100, -5)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 27: Integration / French Labor Law Scenarios
// ═══════════════════════════════════════════════════════════════════════════════

describe("French Labor Law integration scenarios", () => {
  describe("SMIC-level employee (35h/week)", () => {
    it("should calculate a full month at SMIC correctly", () => {
      // SMIC brut horaire ~11.65 EUR (2024 reference)
      // Monthly hours for 35h: 35 * 52/12 = 151.67
      // Monthly gross at SMIC: 11.65 * 151.67 = ~1766.95
      const monthlyHours = computeMonthlyHours(35);
      const smicGross = roundCurrency(11.65 * monthlyHours);
      const smicNet = roundCurrency(smicGross * 0.78); // ~22% charges estimate

      const input = makePayrollInputs({
        contract: {
          gross_salary: smicGross,
          net_salary: smicNet,
          contract_hours: 35,
          cp_n1: 0,
          cp_n: 0,
          total_salary: smicNet,
        },
        workedMinutesMonth: Math.round(monthlyHours * 60),
      });
      const line = computePayrollEmployeeLine(input);

      // Hourly rate should be close to SMIC net hourly
      expect(line.hourlyRateOperational).toBeCloseTo(smicNet / monthlyHours, 2);

      // No extras when working exact contract hours
      expect(line.planningExtraMinutesMonth).toBe(0);
    });
  });

  describe("weekly overtime attached to month of Sunday", () => {
    it("should correctly attribute cross-month overtime to the Sunday month", () => {
      // Scenario: Employee works 45h in a week that spans Jan 26 (Mon) - Feb 1 (Sun)
      // This week MUST be attributed to February (month of Sunday)
      const input = makePayrollInputs({
        contract: makeContract35h(),
        shiftsRaw: [
          { shift_date: "2026-01-26", net_minutes: 540 }, // Monday (Jan) 9h
          { shift_date: "2026-01-27", net_minutes: 540 }, // Tuesday (Jan) 9h
          { shift_date: "2026-01-28", net_minutes: 540 }, // Wednesday (Jan) 9h
          { shift_date: "2026-01-29", net_minutes: 540 }, // Thursday (Jan) 9h
          { shift_date: "2026-01-30", net_minutes: 540 }, // Friday (Jan) 9h
        ],
        targetMonth: "2026-02", // February
        workedMinutesMonth: 0,
      });
      const lineFeb = computePayrollEmployeeLine(input);

      // 45h - 35h = 10h = 600 min extras in February
      expect(lineFeb.planningExtraMinutesMonth).toBe(600);

      // Same shifts, but targeting January -> 0 extras
      const inputJan = makePayrollInputs({
        contract: makeContract35h(),
        shiftsRaw: input.shiftsRaw,
        targetMonth: "2026-01",
        workedMinutesMonth: 0,
      });
      const lineJan = computePayrollEmployeeLine(inputJan);
      expect(lineJan.planningExtraMinutesMonth).toBe(0);
    });
  });

  describe("CP counted but NOT deducted from salary", () => {
    it("should not affect the adjusted salary with CP days alone", () => {
      const input = makePayrollInputs({
        cpDays: 10, // 2 weeks of CP
      });
      const line = computePayrollEmployeeLine(input);
      const adjusted = computeAdjustedGross(line);

      // CP does not affect salary -> adjusted = totalSalary
      expect(adjusted).toBe(line.totalSalary);
      expect(line.cpDays).toBe(10);
      expect(line.cpMinutes).toBe(10 * 420);
      // absenceAmount should be 0 because CP is not an absence
      expect(line.absenceAmount).toBe(0);
    });
  });

  describe("absence deduction uses hourlyRateOperational", () => {
    it("should compute deduction based on total_salary rate, not gross rate", () => {
      const input = makePayrollInputs({
        contract: makeContract39h({ total_salary: 2800 }), // cash component
        absenceDeclaredDays: 3,
      });
      const line = computePayrollEmployeeLine(input);

      // Rate should use totalSalary (2800), not gross (3000)
      const expectedRate = 2800 / 169; // ~16.57
      const expectedAbsenceMinutes = 3 * 420; // 1260 minutes
      const expectedAbsenceAmount = roundCurrency((expectedAbsenceMinutes / 60) * expectedRate);

      expect(line.hourlyRateOperational).toBeCloseTo(expectedRate, 4);
      expect(line.absenceAmount).toBe(expectedAbsenceAmount);
    });
  });

  describe("WEEKS_PER_MONTH = 52/12 is used for base minutes calculation", () => {
    it("should produce correct base minutes for 35h contract", () => {
      const input = makePayrollInputs({
        contract: makeContract35h(),
      });
      const line = computePayrollEmployeeLine(input);

      // baseMinutesMonth = round(35 * 52/12 * 60) = round(9100) = 9100
      expect(line.baseMinutesMonth).toBe(Math.round(35 * WEEKS_PER_MONTH * 60));
    });

    it("should produce correct base minutes for 39h contract", () => {
      const input = makePayrollInputs({
        contract: makeContract39h(),
      });
      const line = computePayrollEmployeeLine(input);

      // baseMinutesMonth = round(39 * 52/12 * 60) = round(10140) = 10140
      expect(line.baseMinutesMonth).toBe(Math.round(39 * WEEKS_PER_MONTH * 60));
    });
  });

  describe("part-time employee (20h/week)", () => {
    it("should compute correctly for a 20h/week part-time contract", () => {
      const input = makePayrollInputs({
        contract: {
          gross_salary: 1100,
          net_salary: 880,
          contract_hours: 20,
          cp_n1: 0,
          cp_n: 0,
          total_salary: 880,
        },
      });
      const line = computePayrollEmployeeLine(input);

      // Monthly hours: 20 * 52/12 = 86.667
      expect(line.monthlyHours).toBeCloseTo(86.6667, 3);

      // Rate: 880 / 86.667 = ~10.154
      expect(line.hourlyRateOperational).toBeCloseTo(880 / line.monthlyHours, 4);

      // Base minutes: round(86.667 * 60)
      expect(line.baseMinutesMonth).toBe(Math.round(line.monthlyHours * 60));
    });
  });

  describe("maximum overtime scenario", () => {
    it("should handle extreme overtime (60h worked on 35h contract)", () => {
      const input = makePayrollInputs({
        contract: makeContract35h(),
        shiftsRaw: [
          // Week: 60h = 5 days * 12h
          { shift_date: "2026-01-05", net_minutes: 720 }, // 12h
          { shift_date: "2026-01-06", net_minutes: 720 },
          { shift_date: "2026-01-07", net_minutes: 720 },
          { shift_date: "2026-01-08", net_minutes: 720 },
          { shift_date: "2026-01-09", net_minutes: 720 }, // 60h total
        ],
        targetMonth: "2026-01",
        workedMinutesMonth: 3600,
      });
      const line = computePayrollEmployeeLine(input);

      // 60h - 35h = 25h = 1500 min extras
      expect(line.planningExtraMinutesMonth).toBe(1500);
    });
  });

  describe("complete payroll with all components", () => {
    it("should produce a coherent payroll line for a full scenario", () => {
      const input = makePayrollInputs({
        contract: makeContract39h({ total_salary: 2800 }),
        extraEvents: [
          { extra_minutes: 90, status: "approved" },
          { extra_minutes: 30, status: "pending" },
        ],
        cpDays: 3,
        absenceDeclaredDays: 1,
        absenceBadgeDays: 1,
        lateMinutesTotal: 25,
        earlyDepartureMinutesTotal: 10,
        shiftsRaw: [
          // Week 1: 42h = 3h extra
          { shift_date: "2026-01-05", net_minutes: 504 },
          { shift_date: "2026-01-06", net_minutes: 504 },
          { shift_date: "2026-01-07", net_minutes: 504 },
          { shift_date: "2026-01-08", net_minutes: 504 },
          { shift_date: "2026-01-09", net_minutes: 504 },
          // Week 2: 39h = 0 extra
          { shift_date: "2026-01-12", net_minutes: 468 },
          { shift_date: "2026-01-13", net_minutes: 468 },
          { shift_date: "2026-01-14", net_minutes: 468 },
          { shift_date: "2026-01-15", net_minutes: 468 },
          { shift_date: "2026-01-16", net_minutes: 468 },
        ],
        targetMonth: "2026-01",
        workedMinutesMonth: 4860,
      });
      const line = computePayrollEmployeeLine(input);

      // Verify internal consistency
      // totalExtraMinutesMonth = badge (90) + planning (180)
      expect(line.totalExtraMinutesMonth).toBe(90 + 180);

      // absenceDaysTotal = declared (1) + badge (1)
      expect(line.absenceDaysTotal).toBe(2);

      // timeDeductionMinutes = late (25) + early (10)
      expect(line.timeDeductionMinutes).toBe(35);

      // adjustedGross should be calculable
      const adjusted = computeAdjustedGross(line);
      expect(adjusted).toBe(
        line.totalSalary + line.totalExtraAmount - line.absenceAmount - line.timeDeductionAmount
      );

      // Charges should be exactly gross - net
      expect(line.chargesFixed).toBe(600);

      // CP minutes calculated but not deducted
      expect(line.cpMinutes).toBe(3 * 420);
    });
  });
});
