/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CASH MODULE — Money Utils Tests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests the pure calculation and formatting functions.
 *
 * Business rules:
 *   CA = CB + Espèces + (Livraison × 0.64) + Courses
 *   Balance = CA - Maintenance - Manque - Acompte
 */

import { describe, it, expect } from "vitest";
import { calculateCA, calculateBalance, calculateTotal, formatEur, parseEurInput, DELIVERY_COEFFICIENT } from "../money";

// ═══════════════════════════════════════════════════════════════════════════
// calculateCA — Chiffre d'Affaires (revenue)
// Formula: CB + Espèces + (Livraison × 0.64) + Courses
// ═══════════════════════════════════════════════════════════════════════════

describe("calculateCA", () => {
  it("returns CB + Espèces + (Livraison × 0.64) + Courses", () => {
    const result = calculateCA({
      cb_eur: 1000,
      cash_eur: 500,
      delivery_eur: 200,
      courses_eur: 100,
      maintenance_eur: 50,
      shortage_eur: 30,
    });
    // 1000 + 500 + (200 × 0.64) + 100 = 1728
    expect(result).toBe(1728);
  });

  it("handles all zeros", () => {
    const result = calculateCA({
      cb_eur: 0,
      cash_eur: 0,
      delivery_eur: 0,
      courses_eur: 0,
      maintenance_eur: 0,
      shortage_eur: 0,
    });
    expect(result).toBe(0);
  });

  it("includes courses in revenue", () => {
    const result = calculateCA({
      cb_eur: 0,
      cash_eur: 0,
      delivery_eur: 0,
      courses_eur: 100,
      maintenance_eur: 50,
      shortage_eur: 25,
    });
    // courses is added to CA
    expect(result).toBe(100);
  });

  it("applies 0.64 coefficient to delivery", () => {
    const result = calculateCA({
      cb_eur: 0,
      cash_eur: 0,
      delivery_eur: 100,
      courses_eur: 0,
      maintenance_eur: 0,
      shortage_eur: 0,
    });
    expect(result).toBe(64);
  });

  it("handles fractional amounts", () => {
    const result = calculateCA({
      cb_eur: 1234.56,
      cash_eur: 789.01,
      delivery_eur: 123.45,
      courses_eur: 45.67,
      maintenance_eur: 0,
      shortage_eur: 12.34,
    });
    // 1234.56 + 789.01 + (123.45 × 0.64) + 45.67 = 2148.248
    expect(result).toBeCloseTo(2148.248, 2);
  });

  it("sums revenue fields correctly with no courses or delivery", () => {
    const result = calculateCA({
      cb_eur: 500,
      cash_eur: 300,
      delivery_eur: 0,
      courses_eur: 0,
      maintenance_eur: 0,
      shortage_eur: 0,
    });
    expect(result).toBe(800);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// calculateBalance — Net balance (CA minus deductions)
// Formula: CA - Maintenance - Manque - Acompte
// ═══════════════════════════════════════════════════════════════════════════

describe("calculateBalance", () => {
  it("returns CA - Maintenance - Manque (courses NOT subtracted)", () => {
    const result = calculateBalance({
      cb_eur: 1000,
      cash_eur: 500,
      delivery_eur: 200,
      courses_eur: 100,
      maintenance_eur: 50,
      shortage_eur: 30,
    });
    // CA = 1728, Balance = 1728 - 50 - 30 = 1648
    expect(result).toBe(1648);
  });

  it("handles all zeros", () => {
    const result = calculateBalance({
      cb_eur: 0,
      cash_eur: 0,
      delivery_eur: 0,
      courses_eur: 0,
      maintenance_eur: 0,
      shortage_eur: 0,
    });
    expect(result).toBe(0);
  });

  it("handles negative result when deductions exceed income", () => {
    const result = calculateBalance({
      cb_eur: 100,
      cash_eur: 0,
      delivery_eur: 0,
      courses_eur: 0,
      maintenance_eur: 200,
      shortage_eur: 50,
    });
    // CA = 100, Balance = 100 - 200 - 50 = -150
    expect(result).toBe(-150);
  });

  it("subtracts advance_eur when present", () => {
    const result = calculateBalance({
      cb_eur: 1000,
      cash_eur: 0,
      delivery_eur: 0,
      courses_eur: 0,
      maintenance_eur: 0,
      shortage_eur: 0,
      advance_eur: 200,
    });
    expect(result).toBe(800);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// calculateCA vs calculateBalance — relationship
// ═══════════════════════════════════════════════════════════════════════════

describe("calculateCA vs calculateBalance relationship", () => {
  it("CA >= Balance when deductions are positive", () => {
    const values = {
      cb_eur: 1000,
      cash_eur: 500,
      delivery_eur: 200,
      courses_eur: 100,
      maintenance_eur: 50,
      shortage_eur: 30,
    };
    expect(calculateCA(values)).toBeGreaterThanOrEqual(calculateBalance(values));
  });

  it("CA === Balance when no deductions", () => {
    const values = {
      cb_eur: 1000,
      cash_eur: 500,
      delivery_eur: 200,
      courses_eur: 0,
      maintenance_eur: 0,
      shortage_eur: 0,
    };
    expect(calculateCA(values)).toBe(calculateBalance(values));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// calculateTotal — deprecated alias for calculateCA
// ═══════════════════════════════════════════════════════════════════════════

describe("calculateTotal (deprecated alias)", () => {
  it("returns same result as calculateCA", () => {
    const values = {
      cb_eur: 1000,
      cash_eur: 500,
      delivery_eur: 200,
      courses_eur: 100,
      maintenance_eur: 50,
      shortage_eur: 30,
    };
    expect(calculateTotal(values)).toBe(calculateCA(values));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELIVERY_COEFFICIENT
// ═══════════════════════════════════════════════════════════════════════════

describe("DELIVERY_COEFFICIENT", () => {
  it("is 0.64", () => {
    expect(DELIVERY_COEFFICIENT).toBe(0.64);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// formatEur
// ═══════════════════════════════════════════════════════════════════════════

describe("formatEur", () => {
  it("formats a positive number as EUR currency", () => {
    const result = formatEur(1234.56);
    expect(result).toContain("1");
    expect(result).toContain("234");
    expect(result).toContain("56");
    expect(result).toContain("€");
  });

  it("formats zero", () => {
    const result = formatEur(0);
    expect(result).toContain("0");
    expect(result).toContain("€");
  });

  it("formats negative numbers", () => {
    const result = formatEur(-500);
    expect(result).toContain("500");
    expect(result).toContain("€");
  });

  it("formats with exactly 2 decimal places", () => {
    const result = formatEur(10);
    expect(result).toContain("00");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseEurInput
// ═══════════════════════════════════════════════════════════════════════════

describe("parseEurInput", () => {
  it("parses a clean number string", () => {
    expect(parseEurInput("123.45")).toBe(123.45);
  });

  it("parses comma as decimal separator", () => {
    expect(parseEurInput("123,45")).toBe(123.45);
  });

  it("strips currency symbols", () => {
    expect(parseEurInput("€123.45")).toBe(123.45);
  });

  it("strips spaces", () => {
    expect(parseEurInput("1 234.56")).toBe(1234.56);
  });

  it("returns 0 for empty string", () => {
    expect(parseEurInput("")).toBe(0);
  });

  it("returns 0 for non-numeric string", () => {
    expect(parseEurInput("abc")).toBe(0);
  });

  it("handles negative sign", () => {
    expect(parseEurInput("-50")).toBe(-50);
  });

  it("parses integer strings", () => {
    expect(parseEurInput("100")).toBe(100);
  });

  it("handles string with just zero", () => {
    expect(parseEurInput("0")).toBe(0);
  });

  it("handles string with leading/trailing whitespace", () => {
    expect(parseEurInput("  42.50  ")).toBe(42.5);
  });
});
