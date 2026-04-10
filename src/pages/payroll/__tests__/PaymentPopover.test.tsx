/**
 * Tests for PaymentPopover & partial payment logic
 *
 * Tests:
 * 1. getPaymentBadgeState — visual state determination
 * 2. computeRemainingForChannel — footer remaining calculation
 * 3. getPaymentStatus — overall row status with partial amounts
 * 4. Backward compatibility rules
 */

import { describe, it, expect } from "vitest";
import {
  getPaymentBadgeState,
  getPaymentStatus,
  computeRemainingForChannel,
} from "../payrollPaymentUtils";

// ─────────────────────────────────────────────────────────────────────────────
// getPaymentBadgeState
// ─────────────────────────────────────────────────────────────────────────────

describe("getPaymentBadgeState", () => {
  it("should return 'unpaid' when paid=false", () => {
    expect(getPaymentBadgeState(false, null, 1000)).toBe("unpaid");
    expect(getPaymentBadgeState(false, 500, 1000)).toBe("unpaid");
    expect(getPaymentBadgeState(false, 0, 1000)).toBe("unpaid");
  });

  it("should return 'full' when paid=true and amountPaid=null (legacy/explicit full)", () => {
    expect(getPaymentBadgeState(true, null, 1463.06)).toBe("full");
  });

  it("should return 'full' when paid=true and amountPaid >= totalAmount", () => {
    expect(getPaymentBadgeState(true, 1463.06, 1463.06)).toBe("full");
    expect(getPaymentBadgeState(true, 2000, 1463.06)).toBe("full");
  });

  it("should return 'partial' when paid=true and amountPaid < totalAmount", () => {
    expect(getPaymentBadgeState(true, 800, 1463.06)).toBe("partial");
    expect(getPaymentBadgeState(true, 0, 1463.06)).toBe("partial");
    expect(getPaymentBadgeState(true, 1, 1463.06)).toBe("partial");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeRemainingForChannel
// ─────────────────────────────────────────────────────────────────────────────

describe("computeRemainingForChannel", () => {
  const total = 1463.06;

  it("should return full amount as remaining when not paid", () => {
    const result = computeRemainingForChannel(false, null, total);
    expect(result.remaining).toBe(total);
    expect(result.paidAmount).toBe(0);
  });

  it("should return 0 remaining when paid=true and amountPaid=null (full payment)", () => {
    const result = computeRemainingForChannel(true, null, total);
    expect(result.remaining).toBe(0);
    expect(result.paidAmount).toBe(total);
  });

  it("should return 0 remaining when paid=true and amountPaid >= total", () => {
    const result = computeRemainingForChannel(true, total, total);
    expect(result.remaining).toBe(0);
    expect(result.paidAmount).toBe(total);
  });

  it("should return 0 remaining when paid=true and amountPaid > total", () => {
    const result = computeRemainingForChannel(true, 2000, total);
    expect(result.remaining).toBe(0);
    expect(result.paidAmount).toBe(total);
  });

  it("should return partial remaining when paid=true and amountPaid < total", () => {
    const result = computeRemainingForChannel(true, 800, total);
    expect(result.remaining).toBeCloseTo(663.06, 2);
    expect(result.paidAmount).toBe(800);
  });

  it("should handle zero partial amount", () => {
    const result = computeRemainingForChannel(true, 0, total);
    expect(result.remaining).toBe(total);
    expect(result.paidAmount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getPaymentStatus (overall row status)
// ─────────────────────────────────────────────────────────────────────────────

describe("getPaymentStatus", () => {
  const netTotal = 1463.06;
  const cashTotal = 300;

  it("should return 'unpaid' when nothing is paid", () => {
    const flags = {
      includeExtras: false,
      includeAbsences: false,
      includeDeductions: false,
      cashPaid: false,
      netPaid: false,
      extrasPaidEur: null,
      netAmountPaid: null,
      cashAmountPaid: null,
    };
    expect(getPaymentStatus(flags, false, netTotal, 0)).toBe("unpaid");
    expect(getPaymentStatus(flags, true, netTotal, cashTotal)).toBe("unpaid");
  });

  it("should return 'paid' when all channels fully paid (legacy boolean)", () => {
    const flags = {
      includeExtras: false,
      includeAbsences: false,
      includeDeductions: false,
      cashPaid: true,
      netPaid: true,
      extrasPaidEur: null,
      netAmountPaid: null,
      cashAmountPaid: null,
    };
    // Both paid with null amounts = fully paid (backward compatible)
    expect(getPaymentStatus(flags, true, netTotal, cashTotal)).toBe("paid");
  });

  it("should return 'paid' when no cash and net fully paid", () => {
    const flags = {
      includeExtras: false,
      includeAbsences: false,
      includeDeductions: false,
      cashPaid: false,
      netPaid: true,
      extrasPaidEur: null,
      netAmountPaid: null,
      cashAmountPaid: null,
    };
    expect(getPaymentStatus(flags, false, netTotal, 0)).toBe("paid");
  });

  it("should return 'partial' when net paid but cash not paid", () => {
    const flags = {
      includeExtras: false,
      includeAbsences: false,
      includeDeductions: false,
      cashPaid: false,
      netPaid: true,
      extrasPaidEur: null,
      netAmountPaid: null,
      cashAmountPaid: null,
    };
    expect(getPaymentStatus(flags, true, netTotal, cashTotal)).toBe("partial");
  });

  it("should return 'partial' when net has partial amount", () => {
    const flags = {
      includeExtras: false,
      includeAbsences: false,
      includeDeductions: false,
      cashPaid: false,
      netPaid: true,
      extrasPaidEur: null,
      netAmountPaid: 800,
      cashAmountPaid: null,
    };
    expect(getPaymentStatus(flags, false, netTotal, 0)).toBe("partial");
  });

  it("should return 'paid' when net has amount >= total and no cash", () => {
    const flags = {
      includeExtras: false,
      includeAbsences: false,
      includeDeductions: false,
      cashPaid: false,
      netPaid: true,
      extrasPaidEur: null,
      netAmountPaid: 1463.06,
      cashAmountPaid: null,
    };
    expect(getPaymentStatus(flags, false, netTotal, 0)).toBe("paid");
  });

  it("should return 'partial' when both paid but net is partial", () => {
    const flags = {
      includeExtras: false,
      includeAbsences: false,
      includeDeductions: false,
      cashPaid: true,
      netPaid: true,
      extrasPaidEur: null,
      netAmountPaid: 800,
      cashAmountPaid: null,
    };
    expect(getPaymentStatus(flags, true, netTotal, cashTotal)).toBe("partial");
  });

  it("should handle undefined flags (not yet set)", () => {
    expect(getPaymentStatus(undefined, false, netTotal, 0)).toBe("unpaid");
    expect(getPaymentStatus(undefined, true, netTotal, cashTotal)).toBe("unpaid");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Backward Compatibility
// ─────────────────────────────────────────────────────────────────────────────

describe("backward compatibility", () => {
  it("netPaid=true + netAmountPaid=null should be fully paid", () => {
    expect(getPaymentBadgeState(true, null, 1463.06)).toBe("full");
    const result = computeRemainingForChannel(true, null, 1463.06);
    expect(result.remaining).toBe(0);
    expect(result.paidAmount).toBe(1463.06);
  });

  it("cashPaid=true + cashAmountPaid=null should be fully paid", () => {
    expect(getPaymentBadgeState(true, null, 300)).toBe("full");
    const result = computeRemainingForChannel(true, null, 300);
    expect(result.remaining).toBe(0);
    expect(result.paidAmount).toBe(300);
  });

  it("netPaid=false → not paid (netAmountPaid ignored)", () => {
    // Even if netAmountPaid has a value, paid=false means not paid
    expect(getPaymentBadgeState(false, 800, 1463.06)).toBe("unpaid");
    const result = computeRemainingForChannel(false, 800, 1463.06);
    expect(result.remaining).toBe(1463.06);
    expect(result.paidAmount).toBe(0);
  });

  it("partial payment: netPaid=true + netAmountPaid=800 → partial (800/1463.06)", () => {
    expect(getPaymentBadgeState(true, 800, 1463.06)).toBe("partial");
    const result = computeRemainingForChannel(true, 800, 1463.06);
    expect(result.remaining).toBeCloseTo(663.06, 2);
    expect(result.paidAmount).toBe(800);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Footer totals with multiple employees (integration-style)
// ─────────────────────────────────────────────────────────────────────────────

describe("footer totals with partial payments", () => {
  it("should correctly aggregate remaining for mixed payment states", () => {
    const employees = [
      {
        netSalary: 1463.06,
        cashAmount: 300,
        netPaid: true,
        netAmountPaid: null,
        cashPaid: true,
        cashAmountPaid: null,
      },
      {
        netSalary: 1200,
        cashAmount: 0,
        netPaid: true,
        netAmountPaid: 800,
        cashPaid: false,
        cashAmountPaid: null,
      },
      {
        netSalary: 1500,
        cashAmount: 200,
        netPaid: false,
        netAmountPaid: null,
        cashPaid: false,
        cashAmountPaid: null,
      },
    ];

    let remainingTransfer = 0;
    let remainingCash = 0;
    let paidTransfer = 0;
    let paidCash = 0;

    for (const emp of employees) {
      const netResult = computeRemainingForChannel(emp.netPaid, emp.netAmountPaid, emp.netSalary);
      remainingTransfer += netResult.remaining;
      paidTransfer += netResult.paidAmount;

      if (emp.cashAmount > 0) {
        const cashResult = computeRemainingForChannel(
          emp.cashPaid,
          emp.cashAmountPaid,
          emp.cashAmount
        );
        remainingCash += cashResult.remaining;
        paidCash += cashResult.paidAmount;
      }
    }

    // Employee 1: net fully paid (0 remaining), cash fully paid (0 remaining)
    // Employee 2: net partial 800/1200 (400 remaining), no cash
    // Employee 3: net not paid (1500 remaining), cash not paid (200 remaining)
    expect(remainingTransfer).toBeCloseTo(1900, 2); // 0 + 400 + 1500
    expect(paidTransfer).toBeCloseTo(2263.06, 2); // 1463.06 + 800 + 0
    expect(remainingCash).toBeCloseTo(200, 2); // 0 + 200
    expect(paidCash).toBeCloseTo(300, 2); // 300 + 0
  });
});
