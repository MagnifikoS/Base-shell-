/**
 * Edge case tests for the Payroll Computation Engine
 *
 * Tests boundary conditions, degenerate inputs, and extreme values:
 * - Zero salary / zero hours / zero contract
 * - Maximum overtime
 * - Negative values
 * - Empty arrays
 * - NaN / Infinity guards
 * - Currency rounding corner cases
 * - Weekly planning extras edge cases
 * - R-Extra edge cases
 * - Totals edge cases
 *
 * French labor law compliance checks:
 * - WEEKS_PER_MONTH = 52/12
 * - DAILY_WORK_MINUTES = 420
 */

import { describe, it, expect } from "vitest";
import {
  WEEKS_PER_MONTH,
  roundCurrency,
  computeMonthlyHours,
  computeHourlyRateOperational,
  computeChargesFixed,
  computeHourlyRateWithCash,
  computeExtraMinutes,
  computeExtraAmount,
  computeAbsenceMinutes,
  computeAbsenceAmount,
  computePayrollEmployeeLine,
  computeAdjustedGross,
  computeAdjustedTotalSalary,
  computeDueBreakdownSimplified,
  computeRExtraDecision,
  computePayrollTotalsFromEmployees,
  sumLateMinutes,
  sumEarlyDepartureMinutes,
  computeHeuresARetirer,
  formatMinutesToHHMM,
  countCpDays,
  countAbsenceDays,
  computePlanningPayrollCost,
  computePlanningExtrasWeekly,
  DEFAULT_VALIDATION_FLAGS,
  type EmployeeContract,
  type PayrollEmployeeInputs,
  type PayrollValidationFlags,
  type PayrollEmployeeForTotals,
  type PlanningShiftRaw,
} from "../payroll.compute";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeContract(overrides?: Partial<EmployeeContract>): EmployeeContract {
  return {
    gross_salary: 2000,
    net_salary: 1600,
    contract_hours: 35,
    cp_n1: 0,
    cp_n: 0,
    total_salary: 1600,
    ...overrides,
  };
}

function makeInputs(overrides?: Partial<PayrollEmployeeInputs>): PayrollEmployeeInputs {
  return {
    contract: makeContract(),
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
// SECTION 1: Zero salary / Zero contract hours
// ═══════════════════════════════════════════════════════════════════════════════

describe("zero salary edge cases", () => {
  it("handles zero gross salary", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        contract: makeContract({ gross_salary: 0, net_salary: 0, total_salary: 0 }),
      })
    );
    expect(line.gross_salary).toBe(0);
    expect(line.hourlyRateOperational).toBe(0);
    expect(line.chargesFixed).toBe(0);
    expect(line.totalSalary).toBe(0);
  });

  it("handles zero net salary with positive gross", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        contract: makeContract({ gross_salary: 2000, net_salary: 0, total_salary: 0 }),
      })
    );
    expect(line.chargesFixed).toBe(2000); // gross - net = 2000 - 0
    expect(line.hourlyRateOperational).toBe(0); // totalSalary=0 / hours
    expect(line.cashAmountComputed).toBe(0);
  });

  it("handles zero contract hours", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        contract: makeContract({ contract_hours: 0 }),
      })
    );
    expect(line.monthlyHours).toBe(0);
    expect(line.hourlyRateOperational).toBe(0);
    expect(line.baseMinutesMonth).toBe(0);
    expect(line.extraAmount).toBe(0);
    expect(line.absenceAmount).toBe(0);
    expect(line.timeDeductionAmount).toBe(0);
  });

  it("handles zero total_salary with non-zero net", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        contract: makeContract({ total_salary: 0, net_salary: 1500 }),
      })
    );
    // total_salary is 0, but it's not null/undefined so it won't fallback to net
    // The ?? operator only kicks in for null/undefined
    expect(line.totalSalary).toBe(0);
  });

  it("handles null total_salary (fallback to net_salary)", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        contract: makeContract({ total_salary: null, net_salary: 1500 }),
      })
    );
    expect(line.totalSalary).toBe(1500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Maximum overtime scenarios
// ═══════════════════════════════════════════════════════════════════════════════

describe("maximum overtime edge cases", () => {
  it("handles 80 hours worked in one week on a 35h contract", () => {
    const extras = computePlanningExtrasWeekly(
      [
        { shift_date: "2026-01-05", net_minutes: 960 }, // 16h
        { shift_date: "2026-01-06", net_minutes: 960 },
        { shift_date: "2026-01-07", net_minutes: 960 },
        { shift_date: "2026-01-08", net_minutes: 960 },
        { shift_date: "2026-01-09", net_minutes: 960 }, // 80h total
      ],
      "2026-01",
      35
    );
    // 80h - 35h = 45h = 2700 minutes
    expect(extras).toBe(2700);
  });

  it("handles zero worked hours (no shifts)", () => {
    const extras = computePlanningExtrasWeekly([], "2026-01", 35);
    expect(extras).toBe(0);
  });

  it("handles exactly contract hours (no extras)", () => {
    const extras = computePlanningExtrasWeekly(
      [
        { shift_date: "2026-01-05", net_minutes: 420 },
        { shift_date: "2026-01-06", net_minutes: 420 },
        { shift_date: "2026-01-07", net_minutes: 420 },
        { shift_date: "2026-01-08", net_minutes: 420 },
        { shift_date: "2026-01-09", net_minutes: 420 }, // 35h
      ],
      "2026-01",
      35
    );
    expect(extras).toBe(0);
  });

  it("handles just 1 minute over contract hours", () => {
    const extras = computePlanningExtrasWeekly(
      [
        { shift_date: "2026-01-05", net_minutes: 421 }, // 1 more than 420
        { shift_date: "2026-01-06", net_minutes: 420 },
        { shift_date: "2026-01-07", net_minutes: 420 },
        { shift_date: "2026-01-08", net_minutes: 420 },
        { shift_date: "2026-01-09", net_minutes: 420 }, // 2101 = 35h01
      ],
      "2026-01",
      35
    );
    expect(extras).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Negative values
// ═══════════════════════════════════════════════════════════════════════════════

describe("negative value guards", () => {
  it("computeMonthlyHours returns 0 for negative hours", () => {
    expect(computeMonthlyHours(-35)).toBe(0);
    expect(computeMonthlyHours(-1)).toBe(0);
  });

  it("computeHourlyRateOperational returns 0 for negative monthlyHours", () => {
    expect(computeHourlyRateOperational(2000, -100)).toBe(0);
  });

  it("computeChargesFixed clamps to 0 for net > gross", () => {
    expect(computeChargesFixed(1000, 2000)).toBe(0);
    expect(computeChargesFixed(0, 500)).toBe(0);
  });

  it("computeHourlyRateWithCash returns 0 for negative monthlyHours", () => {
    expect(computeHourlyRateWithCash(2000, 500, -10)).toBe(0);
  });

  it("computePlanningPayrollCost returns 0 for negative inputs", () => {
    expect(computePlanningPayrollCost(-100, 15)).toBe(0);
    expect(computePlanningPayrollCost(100, -15)).toBe(0);
    expect(computePlanningPayrollCost(-100, -15)).toBe(0);
  });

  it("formatMinutesToHHMM returns 00:00 for negative", () => {
    expect(formatMinutesToHHMM(-60)).toBe("00:00");
    expect(formatMinutesToHHMM(-1)).toBe("00:00");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: NaN and Infinity guards
// ═══════════════════════════════════════════════════════════════════════════════

describe("NaN and Infinity guards", () => {
  it("computeMonthlyHours handles NaN", () => {
    expect(computeMonthlyHours(NaN)).toBe(0);
  });

  it("computeMonthlyHours handles Infinity", () => {
    expect(computeMonthlyHours(Infinity)).toBe(0);
  });

  it("computeMonthlyHours handles -Infinity", () => {
    expect(computeMonthlyHours(-Infinity)).toBe(0);
  });

  it("computeChargesFixed handles NaN gross", () => {
    expect(computeChargesFixed(NaN, 1000)).toBe(0);
  });

  it("computeChargesFixed handles NaN net", () => {
    expect(computeChargesFixed(2000, NaN)).toBe(0);
  });

  it("computeChargesFixed handles Infinity", () => {
    expect(computeChargesFixed(Infinity, 1000)).toBe(0);
  });

  it("computeExtraAmount handles NaN minutes", () => {
    expect(computeExtraAmount(NaN, 15)).toBe(0);
  });

  it("computeExtraAmount handles NaN rate", () => {
    expect(computeExtraAmount(120, NaN)).toBe(0);
  });

  it("computeExtraAmount handles Infinity rate", () => {
    expect(computeExtraAmount(120, Infinity)).toBe(0);
  });

  it("computeExtraAmount handles -Infinity rate", () => {
    expect(computeExtraAmount(120, -Infinity)).toBe(0);
  });

  it("formatMinutesToHHMM handles NaN", () => {
    expect(formatMinutesToHHMM(NaN)).toBe("00:00");
  });

  it("formatMinutesToHHMM handles Infinity", () => {
    expect(formatMinutesToHHMM(Infinity)).toBe("00:00");
  });

  it("formatMinutesToHHMM handles -Infinity", () => {
    expect(formatMinutesToHHMM(-Infinity)).toBe("00:00");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Empty arrays
// ═══════════════════════════════════════════════════════════════════════════════

describe("empty array edge cases", () => {
  it("computeExtraMinutes with empty array returns 0", () => {
    expect(computeExtraMinutes([])).toBe(0);
  });

  it("sumLateMinutes with empty array returns 0", () => {
    expect(sumLateMinutes([])).toBe(0);
  });

  it("sumEarlyDepartureMinutes with empty array returns 0", () => {
    expect(sumEarlyDepartureMinutes([])).toBe(0);
  });

  it("countCpDays with empty array returns 0", () => {
    expect(countCpDays([])).toBe(0);
  });

  it("countAbsenceDays with empty array returns 0", () => {
    expect(countAbsenceDays([])).toBe(0);
  });

  it("computePayrollTotalsFromEmployees with empty array returns all zeros", () => {
    const totals = computePayrollTotalsFromEmployees([]);
    expect(totals.totalGrossBase).toBe(0);
    expect(totals.totalNetBase).toBe(0);
    expect(totals.totalExtras).toBe(0);
    expect(totals.totalMassToDisburse).toBe(0);
    expect(totals.totalChargesFixed).toBe(0);
    expect(totals.totalPayrollMass).toBe(0);
    expect(totals.totalCashAmount).toBe(0);
  });

  it("computePlanningExtrasWeekly with empty shifts returns 0", () => {
    expect(computePlanningExtrasWeekly([], "2026-01", 35)).toBe(0);
  });

  it("computePlanningExtrasWeekly with zero contract hours returns 0", () => {
    const shifts: PlanningShiftRaw[] = [{ shift_date: "2026-01-05", net_minutes: 480 }];
    expect(computePlanningExtrasWeekly(shifts, "2026-01", 0)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: Currency rounding corner cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("roundCurrency — corner cases", () => {
  it("handles banker's rounding edge (0.005)", () => {
    expect(roundCurrency(0.005)).toBe(0.01);
  });

  it("handles 0.004", () => {
    expect(roundCurrency(0.004)).toBe(0);
  });

  it("handles very small negative amount", () => {
    expect(roundCurrency(-0.001)).toBe(-0);
  });

  it("handles exact whole number", () => {
    expect(roundCurrency(100)).toBe(100);
  });

  it("handles 1 centime", () => {
    expect(roundCurrency(0.01)).toBe(0.01);
  });

  it("handles very large amount (100k)", () => {
    expect(roundCurrency(100000.999)).toBe(100001);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: Weekly planning extras — cross-month scenarios
// ═══════════════════════════════════════════════════════════════════════════════

describe("computePlanningExtrasWeekly — cross-month edge cases", () => {
  it("attributes no extras when all shifts are in a different month's week", () => {
    // Shifts on Monday Jan 26 to Friday Jan 30, Sunday is Feb 1
    // Targeting January -> no extras (week belongs to February)
    const extras = computePlanningExtrasWeekly(
      [
        { shift_date: "2026-01-26", net_minutes: 540 },
        { shift_date: "2026-01-27", net_minutes: 540 },
        { shift_date: "2026-01-28", net_minutes: 540 },
        { shift_date: "2026-01-29", net_minutes: 540 },
        { shift_date: "2026-01-30", net_minutes: 540 },
      ],
      "2026-01",
      35
    );
    // Week Sunday is Feb 1 -> belongs to February, not January
    expect(extras).toBe(0);
  });

  it("correctly handles multiple weeks in same month", () => {
    const extras = computePlanningExtrasWeekly(
      [
        // Week 1 (Mon Jan 5 -> Sun Jan 11): 40h = 5h extra
        { shift_date: "2026-01-05", net_minutes: 480 },
        { shift_date: "2026-01-06", net_minutes: 480 },
        { shift_date: "2026-01-07", net_minutes: 480 },
        { shift_date: "2026-01-08", net_minutes: 480 },
        { shift_date: "2026-01-09", net_minutes: 480 },
        // Week 2 (Mon Jan 12 -> Sun Jan 18): 42h = 7h extra
        { shift_date: "2026-01-12", net_minutes: 504 },
        { shift_date: "2026-01-13", net_minutes: 504 },
        { shift_date: "2026-01-14", net_minutes: 504 },
        { shift_date: "2026-01-15", net_minutes: 504 },
        { shift_date: "2026-01-16", net_minutes: 504 },
      ],
      "2026-01",
      35
    );
    // Week 1: (2400 - 2100) = 300 min = 5h
    // Week 2: (2520 - 2100) = 420 min = 7h
    // Total: 720 min = 12h
    expect(extras).toBe(720);
  });

  it("handles shifts on weekends", () => {
    // Saturday Jan 10, Sunday Jan 11 (same week Mon Jan 5 - Sun Jan 11)
    const extras = computePlanningExtrasWeekly(
      [
        { shift_date: "2026-01-05", net_minutes: 480 },
        { shift_date: "2026-01-06", net_minutes: 480 },
        { shift_date: "2026-01-07", net_minutes: 480 },
        { shift_date: "2026-01-08", net_minutes: 480 },
        { shift_date: "2026-01-09", net_minutes: 480 },
        { shift_date: "2026-01-10", net_minutes: 480 }, // Saturday
        { shift_date: "2026-01-11", net_minutes: 480 }, // Sunday
      ],
      "2026-01",
      35
    );
    // 7 * 480 = 3360 min = 56h, extras = 56 - 35 = 21h = 1260 min
    expect(extras).toBe(1260);
  });

  it("handles shift with 0 net_minutes", () => {
    const extras = computePlanningExtrasWeekly(
      [
        { shift_date: "2026-01-05", net_minutes: 0 },
        { shift_date: "2026-01-06", net_minutes: 0 },
      ],
      "2026-01",
      35
    );
    expect(extras).toBe(0);
  });

  it("handles Sunday shifts correctly (day 0 in JS)", () => {
    // Sunday Jan 11, 2026 — getDay() = 0
    // This Sunday belongs to the week Mon Jan 5 - Sun Jan 11
    const extras = computePlanningExtrasWeekly(
      [{ shift_date: "2026-01-11", net_minutes: 600 }], // 10h on Sunday
      "2026-01",
      35
    );
    // Only 10h < 35h => no extras
    expect(extras).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: computePayrollEmployeeLine — edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("computePayrollEmployeeLine — edge cases", () => {
  it("handles all zero inputs", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        contract: makeContract({
          gross_salary: 0,
          net_salary: 0,
          contract_hours: 0,
          total_salary: 0,
        }),
      })
    );

    expect(line.monthlyHours).toBe(0);
    expect(line.hourlyRateOperational).toBe(0);
    expect(line.chargesFixed).toBe(0);
    expect(line.extraMinutes).toBe(0);
    expect(line.absenceAmount).toBe(0);
    expect(line.timeDeductionAmount).toBe(0);
    expect(line.totalSalary).toBe(0);
  });

  it("handles very high salary (executive level)", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        contract: makeContract({
          gross_salary: 15000,
          net_salary: 11500,
          contract_hours: 39,
          total_salary: 12000,
        }),
        absenceDeclaredDays: 1,
        lateMinutesTotal: 10,
      })
    );

    expect(line.monthlyHours).toBe(169);
    expect(line.hourlyRateOperational).toBeCloseTo(12000 / 169, 2);
    expect(line.absenceAmount).toBeGreaterThan(0);
    expect(line.timeDeductionAmount).toBeGreaterThan(0);
  });

  it("handles part-time micro contract (5h/week)", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        contract: makeContract({
          gross_salary: 500,
          net_salary: 400,
          contract_hours: 5,
          total_salary: 400,
        }),
      })
    );

    const expectedHours = 5 * WEEKS_PER_MONTH;
    expect(line.monthlyHours).toBeCloseTo(expectedHours, 3);
    expect(line.hourlyRateOperational).toBeCloseTo(400 / expectedHours, 2);
  });

  it("handles large number of absence days (22 working days = full month absent)", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        absenceDeclaredDays: 22,
      })
    );

    expect(line.absenceDaysTotal).toBe(22);
    expect(line.absenceMinutes).toBe(22 * 420); // 9240 minutes
    expect(line.absenceAmount).toBeGreaterThan(0);
  });

  it("handles simultaneous max absences and max extras", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        extraEvents: [
          { extra_minutes: 600, status: "approved" }, // 10h approved
        ],
        absenceDeclaredDays: 10,
        absenceBadgeDays: 5,
        lateMinutesTotal: 180, // 3h late
        earlyDepartureMinutesTotal: 120, // 2h early departure
        workedMinutesMonth: 12000,
      })
    );

    expect(line.extraMinutes).toBe(600);
    expect(line.absenceDaysTotal).toBe(15);
    expect(line.timeDeductionMinutes).toBe(300);
  });

  it("fallback planning extras formula: workedMinutes < baseMinutes = 0 extras", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        workedMinutesMonth: 5000, // less than base
      })
    );
    expect(line.planningExtraMinutesMonth).toBe(0);
  });

  it("fallback planning extras formula: workedMinutes > baseMinutes = positive extras", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        workedMinutesMonth: 15000, // much more than base
      })
    );
    const base = Math.round(computeMonthlyHours(35) * 60);
    expect(line.planningExtraMinutesMonth).toBe(15000 - base);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: computeAdjustedTotalSalary — edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeAdjustedTotalSalary — edge cases", () => {
  it("returns negative when deductions exceed salary", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        absenceDeclaredDays: 30, // way more than a month
      })
    );
    const flags: PayrollValidationFlags = {
      ...DEFAULT_VALIDATION_FLAGS,
      includeAbsences: true,
    };
    const adjusted = computeAdjustedTotalSalary(line, flags);
    expect(adjusted).toBeLessThan(line.totalSalary);
  });

  it("returns totalSalary when flags is undefined", () => {
    const line = computePayrollEmployeeLine(makeInputs());
    expect(computeAdjustedTotalSalary(line)).toBe(line.totalSalary);
  });

  it("returns totalSalary when all flags false", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        extraEvents: [{ extra_minutes: 120, status: "approved" }],
        absenceDeclaredDays: 2,
        lateMinutesTotal: 30,
      })
    );
    expect(computeAdjustedTotalSalary(line, DEFAULT_VALIDATION_FLAGS)).toBe(line.totalSalary);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: computeDueBreakdownSimplified — edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeDueBreakdownSimplified — edge cases", () => {
  it("handles zero extras with includeExtras true", () => {
    const line = computePayrollEmployeeLine(makeInputs());
    const flags: PayrollValidationFlags = {
      ...DEFAULT_VALIDATION_FLAGS,
      includeExtras: true,
    };
    const breakdown = computeDueBreakdownSimplified(line, flags);
    expect(breakdown.extrasAmountForPay).toBe(0);
    expect(breakdown.adjustedGross).toBe(line.totalSalary);
  });

  it("handles extrasPaidEur = 0 as zero payment (not null)", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        extraEvents: [{ extra_minutes: 120, status: "approved" }],
      })
    );
    const flags: PayrollValidationFlags = {
      ...DEFAULT_VALIDATION_FLAGS,
      includeExtras: true,
      extrasPaidEur: 0,
    };
    const breakdown = computeDueBreakdownSimplified(line, flags);
    expect(breakdown.extrasAmountForPay).toBe(0);
    expect(breakdown.adjustedGross).toBe(roundCurrency(line.totalSalary));
  });

  it("handles all adjustments simultaneously", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        extraEvents: [{ extra_minutes: 60, status: "approved" }],
        absenceDeclaredDays: 1,
        lateMinutesTotal: 30,
        earlyDepartureMinutesTotal: 15,
      })
    );
    const flags: PayrollValidationFlags = {
      ...DEFAULT_VALIDATION_FLAGS,
      includeExtras: true,
      includeAbsences: true,
      includeDeductions: true,
    };
    const breakdown = computeDueBreakdownSimplified(line, flags);
    expect(breakdown.adjustedGross).toBe(
      roundCurrency(
        line.totalSalary + line.totalExtraAmount - line.absenceAmount - line.timeDeductionAmount
      )
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: computeRExtraDecision — edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeRExtraDecision — edge cases", () => {
  it("handles zero extra minutes (nothing to distribute)", () => {
    const line = computePayrollEmployeeLine(makeInputs());
    const decision = computeRExtraDecision(line, null);
    expect(decision.detectedMinutes).toBe(0);
    expect(decision.detectedEur).toBe(0);
    expect(decision.rExtraMinutes).toBe(0);
    expect(decision.rExtraEur).toBe(0);
  });

  it("handles paid = detected (everything paid)", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        extraEvents: [{ extra_minutes: 120, status: "approved" }],
      })
    );
    const decision = computeRExtraDecision(line, line.totalExtraAmount);
    expect(decision.paidEur).toBe(line.totalExtraAmount);
    // R-Extra should be 0 or very close to 0
    expect(decision.rExtraMinutes).toBeLessThanOrEqual(1);
  });

  it("handles negative inputPaidEur (clamps to 0)", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        extraEvents: [{ extra_minutes: 60, status: "approved" }],
      })
    );
    const decision = computeRExtraDecision(line, -50);
    expect(decision.paidEur).toBe(0);
    expect(decision.rExtraMinutes).toBe(decision.totalAvailableMinutes);
  });

  it("handles very large inputPaidEur (clamps to available)", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        extraEvents: [{ extra_minutes: 60, status: "approved" }],
      })
    );
    const decision = computeRExtraDecision(line, 999999);
    expect(decision.paidEur).toBe(decision.totalAvailableEur);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12: computePayrollTotalsFromEmployees — edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("computePayrollTotalsFromEmployees — edge cases", () => {
  it("handles single employee with all zeros", () => {
    const emp: PayrollEmployeeForTotals = {
      userId: "u1",
      line: computePayrollEmployeeLine(
        makeInputs({
          contract: makeContract({
            gross_salary: 0,
            net_salary: 0,
            contract_hours: 0,
            total_salary: 0,
          }),
        })
      ),
    };
    const totals = computePayrollTotalsFromEmployees([emp]);
    expect(totals.totalGrossBase).toBe(0);
    expect(totals.totalPayrollMass).toBe(0);
  });

  it("totalPayrollMass = totalMassToDisburse + totalChargesFixed", () => {
    const emp: PayrollEmployeeForTotals = {
      userId: "u1",
      line: computePayrollEmployeeLine(makeInputs()),
    };
    const totals = computePayrollTotalsFromEmployees([emp]);
    expect(totals.totalPayrollMass).toBe(totals.totalMassToDisburse + totals.totalChargesFixed);
  });

  it("handles 10 employees", () => {
    const employees: PayrollEmployeeForTotals[] = Array.from({ length: 10 }, (_, i) => ({
      userId: `u${i}`,
      line: computePayrollEmployeeLine(makeInputs()),
    }));
    const totals = computePayrollTotalsFromEmployees(employees);
    expect(totals.totalGrossBase).toBe(2000 * 10);
    expect(totals.totalNetBase).toBe(1600 * 10);
  });

  it("handles validation flags for some employees only", () => {
    const emp1: PayrollEmployeeForTotals = {
      userId: "u1",
      line: computePayrollEmployeeLine(
        makeInputs({
          extraEvents: [{ extra_minutes: 120, status: "approved" }],
        })
      ),
    };
    const emp2: PayrollEmployeeForTotals = {
      userId: "u2",
      line: computePayrollEmployeeLine(makeInputs()),
    };

    const validationMap = new Map<string, PayrollValidationFlags>([
      ["u1", { ...DEFAULT_VALIDATION_FLAGS, includeExtras: true }],
      // u2 has no flags -> defaults to no adjustments
    ]);

    const totals = computePayrollTotalsFromEmployees([emp1, emp2], validationMap);
    const expectedMass = emp1.line.totalSalary + emp1.line.totalExtraAmount + emp2.line.totalSalary;
    expect(totals.totalMassToDisburse).toBeCloseTo(expectedMass, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 13: countCpDays / countAbsenceDays — edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("countCpDays — edge cases", () => {
  it("handles mixed statuses on same date", () => {
    const leaves = [
      { leave_date: "2026-01-10", leave_type: "cp", status: "approved" },
      { leave_date: "2026-01-10", leave_type: "cp", status: "rejected" },
    ];
    // Only the approved one counts, and deduplication gives 1
    expect(countCpDays(leaves)).toBe(1);
  });

  it("handles large number of CP days (30 days)", () => {
    const leaves = Array.from({ length: 30 }, (_, i) => ({
      leave_date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      leave_type: "cp",
      status: "approved",
    }));
    expect(countCpDays(leaves)).toBe(30);
  });
});

describe("countAbsenceDays — edge cases", () => {
  it("does not count 'repos' as absence", () => {
    const leaves = [
      { leave_date: "2026-01-10", leave_type: "repos", status: "approved" },
      { leave_date: "2026-01-11", leave_type: "absence", status: "approved" },
    ];
    expect(countAbsenceDays(leaves)).toBe(1);
  });

  it("does not count 'maladie' or other types", () => {
    const leaves = [
      { leave_date: "2026-01-10", leave_type: "maladie", status: "approved" },
      { leave_date: "2026-01-11", leave_type: "absence", status: "approved" },
    ];
    expect(countAbsenceDays(leaves)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 14: computeHeuresARetirer — edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeHeuresARetirer — edge cases", () => {
  it("handles very large combined value", () => {
    const result = computeHeuresARetirer(600, 300);
    expect(result.totalMinutes).toBe(900);
    expect(result.hhmm).toBe("15:00");
  });

  it("handles only late minutes", () => {
    const result = computeHeuresARetirer(45, 0);
    expect(result.totalMinutes).toBe(45);
    expect(result.hhmm).toBe("00:45");
  });

  it("handles only early departure", () => {
    const result = computeHeuresARetirer(0, 90);
    expect(result.totalMinutes).toBe(90);
    expect(result.hhmm).toBe("01:30");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 15: computeAbsenceMinutes / computeAbsenceAmount — edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeAbsenceMinutes — edge cases", () => {
  it("handles negative days (should not happen but doesn't crash)", () => {
    expect(computeAbsenceMinutes(-1)).toBe(-420);
  });

  it("handles very large number of days", () => {
    expect(computeAbsenceMinutes(365)).toBe(365 * 420);
  });
});

describe("computeAbsenceAmount — edge cases", () => {
  it("returns 0 for 0 rate", () => {
    expect(computeAbsenceAmount(420, 0)).toBe(0);
  });

  it("computes correctly for fractional rate", () => {
    // 420 min at 11.538 EUR/h = 7h * 11.538 = 80.766 -> 80.77
    expect(computeAbsenceAmount(420, 11.538)).toBe(80.77);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 16: computeAdjustedGross — consistency check
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeAdjustedGross — consistency", () => {
  it("always equals totalSalary + totalExtraAmount - absenceAmount - timeDeductionAmount", () => {
    const line = computePayrollEmployeeLine(
      makeInputs({
        extraEvents: [{ extra_minutes: 90, status: "approved" }],
        absenceDeclaredDays: 2,
        lateMinutesTotal: 40,
        earlyDepartureMinutesTotal: 20,
        workedMinutesMonth: 10000,
      })
    );
    const adjusted = computeAdjustedGross(line);
    expect(adjusted).toBe(
      line.totalSalary + line.totalExtraAmount - line.absenceAmount - line.timeDeductionAmount
    );
  });
});
