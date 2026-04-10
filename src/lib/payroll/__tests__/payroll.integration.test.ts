/**
 * Payroll Engine — Integration Tests
 *
 * These tests verify the full payroll computation flow with realistic
 * multi-employee scenarios and complex French labor law edge cases.
 *
 * Unlike the unit tests in payroll.compute.test.ts, these tests:
 * - Simulate a full monthly payroll with multiple employees
 * - Verify overtime calculations across week boundaries
 * - Test absence deduction accuracy
 * - Verify CP (conges payes) counted but never deducted
 * - Test R-Extra calculation with partial payment scenarios
 * - Verify the complete due breakdown flow
 *
 * All values use realistic French payroll figures.
 */

import { describe, it, expect } from "vitest";
import {
  roundCurrency,
  computeMonthlyHours,
  computePayrollEmployeeLine,
  computeAdjustedTotalSalary,
  computeDueBreakdownSimplified,
  computeRExtraDecision,
  computePayrollTotalsFromEmployees,
  computePlanningExtrasWeekly,
  DAILY_WORK_MINUTES,
  type EmployeeContract,
  type PayrollEmployeeInputs,
  type PayrollValidationFlags,
  type PayrollEmployeeForTotals,
  DEFAULT_VALIDATION_FLAGS,
} from "../payroll.compute";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeContract(overrides: Partial<EmployeeContract> = {}): EmployeeContract {
  return {
    gross_salary: 2500,
    net_salary: 2000,
    contract_hours: 35,
    cp_n1: 10,
    cp_n: 5,
    total_salary: 2000,
    ...overrides,
  };
}

function makeInputs(overrides: Partial<PayrollEmployeeInputs> = {}): PayrollEmployeeInputs {
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

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: Full month calculation with multiple employees
// ─────────────────────────────────────────────────────────────────────────────

describe("Full month payroll with multiple employees", () => {
  it("produces correct totals for 3 employees with different profiles", () => {
    // Employee 1: Cook, 39h, with extras and late
    const cook = {
      userId: "cook-1",
      line: computePayrollEmployeeLine(
        makeInputs({
          contract: makeContract({
            gross_salary: 2800,
            net_salary: 2240,
            contract_hours: 39,
            total_salary: 2500, // 260 cash
          }),
          extraEvents: [
            { extra_minutes: 90, status: "approved" as const },
            { extra_minutes: 60, status: "pending" as const },
          ],
          lateMinutesTotal: 15,
          earlyDepartureMinutesTotal: 10,
          workedMinutesMonth: 10200,
          shiftsRaw: [
            // Week 1: 42h = 180 min extra (Mon Jan 5 -> Sun Jan 11)
            { shift_date: "2026-01-05", net_minutes: 504 },
            { shift_date: "2026-01-06", net_minutes: 504 },
            { shift_date: "2026-01-07", net_minutes: 504 },
            { shift_date: "2026-01-08", net_minutes: 504 },
            { shift_date: "2026-01-09", net_minutes: 504 },
          ],
          targetMonth: "2026-01",
        })
      ),
    };

    // Employee 2: Server, 35h, with absences
    const server = {
      userId: "server-1",
      line: computePayrollEmployeeLine(
        makeInputs({
          contract: makeContract({
            gross_salary: 2200,
            net_salary: 1760,
            contract_hours: 35,
            total_salary: 1760,
          }),
          absenceDeclaredDays: 3,
          absenceBadgeDays: 1,
          cpDays: 2,
          workedMinutesMonth: 7200,
        })
      ),
    };

    // Employee 3: Manager, 39h, clean month
    const manager = {
      userId: "manager-1",
      line: computePayrollEmployeeLine(
        makeInputs({
          contract: makeContract({
            gross_salary: 3500,
            net_salary: 2800,
            contract_hours: 39,
            total_salary: 3200, // 400 cash
          }),
          workedMinutesMonth: 10140,
        })
      ),
    };

    const employees: PayrollEmployeeForTotals[] = [cook, server, manager];

    // Validation: cook gets extras+deductions, server gets absences, manager clean
    const validationMap = new Map<string, PayrollValidationFlags>([
      [
        "cook-1",
        {
          ...DEFAULT_VALIDATION_FLAGS,
          includeExtras: true,
          includeDeductions: true,
        },
      ],
      [
        "server-1",
        {
          ...DEFAULT_VALIDATION_FLAGS,
          includeAbsences: true,
        },
      ],
      ["manager-1", DEFAULT_VALIDATION_FLAGS],
    ]);

    const totals = computePayrollTotalsFromEmployees(employees, validationMap);

    // Verify individual lines make sense
    expect(cook.line.totalSalary).toBe(2500);
    expect(cook.line.cashAmountComputed).toBe(260); // 2500 - 2240
    expect(cook.line.chargesFixed).toBe(560); // 2800 - 2240
    expect(cook.line.extraMinutes).toBe(90); // only approved badge extras
    expect(cook.line.planningExtraMinutesMonth).toBe(180); // 42h - 39h = 3h
    expect(cook.line.totalExtraMinutesMonth).toBe(270); // 90 + 180
    expect(cook.line.timeDeductionMinutes).toBe(25); // 15 + 10

    expect(server.line.absenceDaysTotal).toBe(4); // 3 declared + 1 badge
    expect(server.line.absenceMinutes).toBe(4 * DAILY_WORK_MINUTES);
    expect(server.line.cpDays).toBe(2);
    expect(server.line.cpMinutes).toBe(2 * DAILY_WORK_MINUTES);

    expect(manager.line.totalExtraMinutesMonth).toBe(0);
    expect(manager.line.absenceAmount).toBe(0);
    expect(manager.line.cashAmountComputed).toBe(400);

    // Verify aggregate totals
    expect(totals.totalGrossBase).toBe(2800 + 2200 + 3500);
    expect(totals.totalNetBase).toBe(2240 + 1760 + 2800);
    expect(totals.totalChargesFixed).toBe(560 + 440 + 700);
    expect(totals.totalCpDays).toBe(2);

    // Verify totalMassToDisburse includes flag-based adjustments
    const cookAdjusted =
      cook.line.totalSalary + cook.line.totalExtraAmount - cook.line.timeDeductionAmount;
    const serverAdjusted = server.line.totalSalary - server.line.absenceAmount;
    const managerAdjusted = manager.line.totalSalary; // no flags

    expect(totals.totalMassToDisburse).toBeCloseTo(
      cookAdjusted + serverAdjusted + managerAdjusted,
      2
    );

    // Verify payroll mass = disbursements + charges
    expect(totals.totalPayrollMass).toBeCloseTo(
      totals.totalMassToDisburse + totals.totalChargesFixed,
      2
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: Overtime across week boundaries
// ─────────────────────────────────────────────────────────────────────────────

describe("Overtime across week boundaries (French labor law)", () => {
  it("correctly handles 4-week month with varying workloads", () => {
    // January 2026: 4 full weeks
    // Week 1 (Jan 5-11, Sun): 40h = 5h extra for 35h contract
    // Week 2 (Jan 12-18, Sun): 35h = 0 extra
    // Week 3 (Jan 19-25, Sun): 42h = 7h extra
    // Week 4 (Jan 26-Feb 1, Sun): 38h = 3h extra -> BUT attached to February!

    const shifts = [
      // Week 1: Mon-Fri 8h/day = 40h
      { shift_date: "2026-01-05", net_minutes: 480 },
      { shift_date: "2026-01-06", net_minutes: 480 },
      { shift_date: "2026-01-07", net_minutes: 480 },
      { shift_date: "2026-01-08", net_minutes: 480 },
      { shift_date: "2026-01-09", net_minutes: 480 },
      // Week 2: Mon-Fri 7h/day = 35h
      { shift_date: "2026-01-12", net_minutes: 420 },
      { shift_date: "2026-01-13", net_minutes: 420 },
      { shift_date: "2026-01-14", net_minutes: 420 },
      { shift_date: "2026-01-15", net_minutes: 420 },
      { shift_date: "2026-01-16", net_minutes: 420 },
      // Week 3: Mon-Fri 8.4h/day = 42h
      { shift_date: "2026-01-19", net_minutes: 504 },
      { shift_date: "2026-01-20", net_minutes: 504 },
      { shift_date: "2026-01-21", net_minutes: 504 },
      { shift_date: "2026-01-22", net_minutes: 504 },
      { shift_date: "2026-01-23", net_minutes: 504 },
      // Week 4: Mon-Fri (spans Jan->Feb, Sunday is Feb 1)
      { shift_date: "2026-01-26", net_minutes: 456 },
      { shift_date: "2026-01-27", net_minutes: 456 },
      { shift_date: "2026-01-28", net_minutes: 456 },
      { shift_date: "2026-01-29", net_minutes: 456 },
      { shift_date: "2026-01-30", net_minutes: 456 },
    ];

    // January: Week 1 (5h), Week 2 (0h), Week 3 (7h) = 12h = 720 min
    // Week 4 is attached to February (Sunday is Feb 1)
    const janExtras = computePlanningExtrasWeekly(shifts, "2026-01", 35);
    expect(janExtras).toBe(300 + 0 + 420); // 5h + 0 + 7h = 720 min

    // February: Week 4 only (38h - 35h = 3h = 180 min)
    const febExtras = computePlanningExtrasWeekly(shifts, "2026-02", 35);
    expect(febExtras).toBe(180); // 3h extra
  });

  it("handles week that spans year boundary", () => {
    // Week: Dec 29 (Mon) -> Jan 4 (Sun)
    // This week should be attached to January (month of Sunday)
    const shifts = [
      { shift_date: "2025-12-29", net_minutes: 480 },
      { shift_date: "2025-12-30", net_minutes: 480 },
      { shift_date: "2025-12-31", net_minutes: 480 },
      { shift_date: "2026-01-01", net_minutes: 480 },
      { shift_date: "2026-01-02", net_minutes: 480 },
    ];

    // Should appear in January 2026 (month of Sunday Jan 4)
    const janExtras = computePlanningExtrasWeekly(shifts, "2026-01", 35);
    // 5 * 8h = 40h, 40h - 35h = 5h = 300 min
    expect(janExtras).toBe(300);

    // Should NOT appear in December 2025
    const decExtras = computePlanningExtrasWeekly(shifts, "2025-12", 35);
    expect(decExtras).toBe(0);
  });

  it("produces zero extras when all weeks are at or below contract hours", () => {
    const shifts = [
      // Week 1: 35h
      { shift_date: "2026-01-05", net_minutes: 420 },
      { shift_date: "2026-01-06", net_minutes: 420 },
      { shift_date: "2026-01-07", net_minutes: 420 },
      { shift_date: "2026-01-08", net_minutes: 420 },
      { shift_date: "2026-01-09", net_minutes: 420 },
      // Week 2: 30h (below contract)
      { shift_date: "2026-01-12", net_minutes: 360 },
      { shift_date: "2026-01-13", net_minutes: 360 },
      { shift_date: "2026-01-14", net_minutes: 360 },
      { shift_date: "2026-01-15", net_minutes: 360 },
      { shift_date: "2026-01-16", net_minutes: 360 },
    ];

    const extras = computePlanningExtrasWeekly(shifts, "2026-01", 35);
    expect(extras).toBe(0);
  });

  it("only counts positive extras per week (deficit weeks do not offset)", () => {
    // This is key: a short week does NOT reduce extras from a long week
    const shifts = [
      // Week 1: 50h = 15h extra
      { shift_date: "2026-01-05", net_minutes: 600 },
      { shift_date: "2026-01-06", net_minutes: 600 },
      { shift_date: "2026-01-07", net_minutes: 600 },
      { shift_date: "2026-01-08", net_minutes: 600 },
      { shift_date: "2026-01-09", net_minutes: 600 },
      // Week 2: 20h (deficit of 15h, but this does NOT reduce week 1 extras)
      { shift_date: "2026-01-12", net_minutes: 240 },
      { shift_date: "2026-01-13", net_minutes: 240 },
      { shift_date: "2026-01-14", net_minutes: 240 },
      { shift_date: "2026-01-15", net_minutes: 240 },
      { shift_date: "2026-01-16", net_minutes: 240 },
    ];

    const extras = computePlanningExtrasWeekly(shifts, "2026-01", 35);
    // Week 1: 50h - 35h = 15h = 900 min
    // Week 2: max(0, 20h - 35h) = 0
    // Total: 900 min
    expect(extras).toBe(900);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: Absence deduction calculations
// ─────────────────────────────────────────────────────────────────────────────

describe("Absence deduction calculations", () => {
  it("correctly deducts absences using hourlyRateOperational", () => {
    const input = makeInputs({
      contract: makeContract({
        gross_salary: 3000,
        net_salary: 2400,
        contract_hours: 39,
        total_salary: 2800, // cash component
      }),
      absenceDeclaredDays: 5,
    });

    const line = computePayrollEmployeeLine(input);

    // hourlyRateOperational = 2800 / 169 = ~16.568
    const expectedRate = 2800 / computeMonthlyHours(39);
    expect(line.hourlyRateOperational).toBeCloseTo(expectedRate, 4);

    // 5 days * 420 min = 2100 min = 35h
    const expectedAbsence = roundCurrency((2100 / 60) * expectedRate);
    expect(line.absenceMinutes).toBe(2100);
    expect(line.absenceAmount).toBe(expectedAbsence);
  });

  it("combines declared and badge absences", () => {
    const input = makeInputs({
      absenceDeclaredDays: 2,
      absenceBadgeDays: 3,
    });

    const line = computePayrollEmployeeLine(input);

    expect(line.absenceDeclaredDays).toBe(2);
    expect(line.absenceBadgeDays).toBe(3);
    expect(line.absenceDaysTotal).toBe(5);
    expect(line.absenceMinutes).toBe(5 * DAILY_WORK_MINUTES);
  });

  it("absence amount scales correctly with salary level", () => {
    // Low salary employee
    const lowInput = makeInputs({
      contract: makeContract({
        gross_salary: 1800,
        net_salary: 1440,
        contract_hours: 35,
        total_salary: 1440,
      }),
      absenceDeclaredDays: 1,
    });

    // High salary employee
    const highInput = makeInputs({
      contract: makeContract({
        gross_salary: 4000,
        net_salary: 3200,
        contract_hours: 35,
        total_salary: 3200,
      }),
      absenceDeclaredDays: 1,
    });

    const lowLine = computePayrollEmployeeLine(lowInput);
    const highLine = computePayrollEmployeeLine(highInput);

    // Both have 1 day absence = 420 min = 7h
    expect(lowLine.absenceMinutes).toBe(420);
    expect(highLine.absenceMinutes).toBe(420);

    // High salary employee should have higher deduction
    expect(highLine.absenceAmount).toBeGreaterThan(lowLine.absenceAmount);

    // Ratio of deductions should match ratio of total salaries
    const ratio = highLine.absenceAmount / lowLine.absenceAmount;
    const salaryRatio = 3200 / 1440;
    expect(ratio).toBeCloseTo(salaryRatio, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: CP counted but not deducted
// ─────────────────────────────────────────────────────────────────────────────

describe("CP (conges payes) counted but not deducted", () => {
  it("CP does not reduce adjusted salary regardless of validation flags", () => {
    const input = makeInputs({
      cpDays: 10,
      absenceDeclaredDays: 0,
    });

    const line = computePayrollEmployeeLine(input);

    // CP is tracked but not deducted
    expect(line.cpDays).toBe(10);
    expect(line.cpMinutes).toBe(10 * DAILY_WORK_MINUTES);

    // Absence amount should be 0 (CP is NOT absence for payroll)
    expect(line.absenceAmount).toBe(0);
    expect(line.absenceDaysTotal).toBe(0);

    // Adjusted salary should equal base (no deduction)
    const flags: PayrollValidationFlags = {
      ...DEFAULT_VALIDATION_FLAGS,
      includeAbsences: true, // Even with this flag, CP is not deducted
    };
    const adjusted = computeAdjustedTotalSalary(line, flags);
    expect(adjusted).toBe(line.totalSalary);
  });

  it("CP and absences are tracked independently in the same month", () => {
    const input = makeInputs({
      cpDays: 5,
      absenceDeclaredDays: 3,
    });

    const line = computePayrollEmployeeLine(input);

    // Both tracked
    expect(line.cpDays).toBe(5);
    expect(line.cpMinutes).toBe(5 * DAILY_WORK_MINUTES);
    expect(line.absenceDaysTotal).toBe(3);
    expect(line.absenceMinutes).toBe(3 * DAILY_WORK_MINUTES);

    // Only non-CP absences generate deduction
    expect(line.absenceAmount).toBeGreaterThan(0);

    // With all flags enabled, salary is reduced only by absences
    const flags: PayrollValidationFlags = {
      ...DEFAULT_VALIDATION_FLAGS,
      includeAbsences: true,
    };
    const adjusted = computeAdjustedTotalSalary(line, flags);
    expect(adjusted).toBe(line.totalSalary - line.absenceAmount);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: R-Extra calculation scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe("R-Extra calculation scenarios", () => {
  it("full payment: R-Extra is 0 when all extras are paid on salary", () => {
    const input = makeInputs({
      contract: makeContract({
        gross_salary: 3000,
        net_salary: 2400,
        contract_hours: 39,
        total_salary: 2400,
      }),
      extraEvents: [{ extra_minutes: 120, status: "approved" as const }],
      shiftsRaw: [
        // 42h worked = 3h extra
        { shift_date: "2026-01-05", net_minutes: 504 },
        { shift_date: "2026-01-06", net_minutes: 504 },
        { shift_date: "2026-01-07", net_minutes: 504 },
        { shift_date: "2026-01-08", net_minutes: 504 },
        { shift_date: "2026-01-09", net_minutes: 504 },
      ],
      targetMonth: "2026-01",
      workedMinutesMonth: 2520,
    });

    const line = computePayrollEmployeeLine(input);
    const decision = computeRExtraDecision(line, line.totalExtraAmount);

    // All paid => R-Extra should be 0 or very close
    expect(decision.paidEur).toBe(line.totalExtraAmount);
    expect(decision.rExtraMinutes).toBeLessThanOrEqual(1); // rounding tolerance
  });

  it("partial payment: R-Extra reflects unpaid portion", () => {
    const input = makeInputs({
      contract: makeContract({
        gross_salary: 3000,
        net_salary: 2400,
        contract_hours: 39,
        total_salary: 2400,
      }),
      extraEvents: [{ extra_minutes: 120, status: "approved" as const }],
      workedMinutesMonth: 10200,
    });

    const line = computePayrollEmployeeLine(input);

    // Pay only half
    const halfPay = roundCurrency(line.totalExtraAmount / 2);
    const decision = computeRExtraDecision(line, halfPay);

    expect(decision.paidEur).toBe(halfPay);
    expect(decision.rExtraMinutes).toBeGreaterThan(0);
    expect(decision.rExtraEur).toBeGreaterThan(0);

    // R-Extra EUR should be approximately half of total
    expect(decision.rExtraEur).toBeCloseTo(line.totalExtraAmount - halfPay, 1);
  });

  it("zero payment: all extras become R-Extra", () => {
    const input = makeInputs({
      extraEvents: [{ extra_minutes: 180, status: "approved" as const }],
      workedMinutesMonth: 0,
    });

    const line = computePayrollEmployeeLine(input);
    const decision = computeRExtraDecision(line, 0);

    expect(decision.paidEur).toBe(0);
    expect(decision.rExtraMinutes).toBe(decision.totalAvailableMinutes);
    expect(decision.rExtraEur).toBe(decision.totalAvailableEur);
  });

  it("overpayment is clamped to available amount", () => {
    const input = makeInputs({
      extraEvents: [{ extra_minutes: 60, status: "approved" as const }],
      workedMinutesMonth: 0,
    });

    const line = computePayrollEmployeeLine(input);
    const decision = computeRExtraDecision(line, 999999);

    expect(decision.paidEur).toBe(line.totalExtraAmount);
    expect(decision.rExtraMinutes).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: Due breakdown flow
// ─────────────────────────────────────────────────────────────────────────────

describe("Due breakdown flow (computeDueBreakdownSimplified)", () => {
  it("end-to-end: raw amounts, flag-based application, and adjusted salary", () => {
    const input = makeInputs({
      contract: makeContract({
        gross_salary: 3000,
        net_salary: 2400,
        contract_hours: 39,
        total_salary: 2800,
      }),
      extraEvents: [
        { extra_minutes: 120, status: "approved" as const },
        { extra_minutes: 30, status: "pending" as const },
      ],
      absenceDeclaredDays: 2,
      lateMinutesTotal: 45,
      earlyDepartureMinutesTotal: 20,
      workedMinutesMonth: 10500,
      shiftsRaw: [
        { shift_date: "2026-01-05", net_minutes: 504 },
        { shift_date: "2026-01-06", net_minutes: 504 },
        { shift_date: "2026-01-07", net_minutes: 504 },
        { shift_date: "2026-01-08", net_minutes: 504 },
        { shift_date: "2026-01-09", net_minutes: 504 },
      ],
      targetMonth: "2026-01",
    });

    const line = computePayrollEmployeeLine(input);

    // Test with all flags enabled
    const allFlags: PayrollValidationFlags = {
      ...DEFAULT_VALIDATION_FLAGS,
      includeExtras: true,
      includeAbsences: true,
      includeDeductions: true,
    };

    const breakdown = computeDueBreakdownSimplified(line, allFlags);

    // Raw amounts should reflect computed values
    expect(breakdown.extrasMinutesRaw).toBe(line.totalExtraMinutesMonth);
    expect(breakdown.extrasAmountRaw).toBe(line.totalExtraAmount);
    expect(breakdown.deductionMinutesRaw).toBe(line.timeDeductionMinutes);
    expect(breakdown.deductionAmountRaw).toBe(line.timeDeductionAmount);
    expect(breakdown.absencesAmountRaw).toBe(line.absenceAmount);

    // Applied amounts should match (all flags true)
    expect(breakdown.extrasAmountForPay).toBe(line.totalExtraAmount);
    expect(breakdown.deductionAmountForPay).toBe(line.timeDeductionAmount);
    expect(breakdown.absencesAmountForPay).toBe(line.absenceAmount);

    // Adjusted gross should be base + extras - absences - deductions
    const expectedAdjusted = roundCurrency(
      line.totalSalary + line.totalExtraAmount - line.absenceAmount - line.timeDeductionAmount
    );
    expect(breakdown.adjustedGross).toBe(expectedAdjusted);
  });

  it("partial extras payment uses extrasPaidEur correctly", () => {
    const input = makeInputs({
      extraEvents: [{ extra_minutes: 120, status: "approved" as const }],
      workedMinutesMonth: 0,
    });

    const line = computePayrollEmployeeLine(input);

    const partialAmount = 25.5;
    const flags: PayrollValidationFlags = {
      ...DEFAULT_VALIDATION_FLAGS,
      includeExtras: true,
      extrasPaidEur: partialAmount,
    };

    const breakdown = computeDueBreakdownSimplified(line, flags);

    // Should use partialAmount, not full amount
    expect(breakdown.extrasAmountForPay).toBe(partialAmount);
    expect(breakdown.adjustedGross).toBe(roundCurrency(line.totalSalary + partialAmount));
  });

  it("no flags applied: adjusted equals base total salary", () => {
    const input = makeInputs({
      extraEvents: [{ extra_minutes: 120, status: "approved" as const }],
      absenceDeclaredDays: 3,
      lateMinutesTotal: 60,
    });

    const line = computePayrollEmployeeLine(input);
    const breakdown = computeDueBreakdownSimplified(line, undefined);

    // No flags => no adjustments
    expect(breakdown.extrasAmountForPay).toBe(0);
    expect(breakdown.deductionAmountForPay).toBe(0);
    expect(breakdown.absencesAmountForPay).toBe(0);
    expect(breakdown.adjustedGross).toBe(line.totalSalary);

    // But raw amounts should still be computed
    expect(breakdown.extrasAmountRaw).toBeGreaterThan(0);
    expect(breakdown.absencesAmountRaw).toBeGreaterThan(0);
    expect(breakdown.deductionAmountRaw).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test: Currency rounding consistency
// ─────────────────────────────────────────────────────────────────────────────

describe("Currency rounding consistency across the pipeline", () => {
  it("all EUR amounts are rounded to 2 decimal places", () => {
    const input = makeInputs({
      contract: makeContract({
        gross_salary: 2777,
        net_salary: 2222,
        contract_hours: 37, // unusual hours to force rounding
        total_salary: 2555,
      }),
      extraEvents: [{ extra_minutes: 77, status: "approved" as const }],
      absenceDeclaredDays: 3,
      lateMinutesTotal: 13,
      earlyDepartureMinutesTotal: 7,
      workedMinutesMonth: 9000,
    });

    const line = computePayrollEmployeeLine(input);

    // Check all EUR amounts have at most 2 decimal places
    function checkDecimalPlaces(value: number, label: string) {
      const str = value.toString();
      if (str.includes(".")) {
        const decimals = str.split(".")[1].length;
        expect(decimals, `${label} = ${value} has ${decimals} decimal places`).toBeLessThanOrEqual(2);
      }
    }

    checkDecimalPlaces(line.extraAmount, "extraAmount");
    checkDecimalPlaces(line.absenceAmount, "absenceAmount");
    checkDecimalPlaces(line.timeDeductionAmount, "timeDeductionAmount");
    checkDecimalPlaces(line.totalExtraAmount, "totalExtraAmount");
    // hourlyRate can have more decimals (it's a rate, not a currency)
  });
});
