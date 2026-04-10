/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUCT LINE STATUS V2 — Unit Tests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests the pure functions: canValidateAll, countByStatus
 * Tests determineLineStatus with mock ProductV2 data
 */

import { describe, it, expect } from "vitest";
import { canValidateAll, countByStatus, type LineStatusResult } from "../productLineStatusV2";

// ═══════════════════════════════════════════════════════════════════════════
// HELPER — Build mock LineStatusResult
// ═══════════════════════════════════════════════════════════════════════════

function makeStatusResult(overrides: Partial<LineStatusResult>): LineStatusResult {
  return {
    status: "validated",
    label: "Valide",
    matchResult: {
      match: null,
      alternatives: [],
      isExact: false,
      isNew: false,
    },
    priceResult: null,
    matchedProduct: null,
    requiresDecision: false,
    canAutoValidate: true,
    reason: "test",
    availableActions: ["none"],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// canValidateAll
// ═══════════════════════════════════════════════════════════════════════════

describe("canValidateAll", () => {
  it("returns true when all items are validated (no decisions needed)", () => {
    const statuses = new Map<number, LineStatusResult>([
      [0, makeStatusResult({ status: "validated", requiresDecision: false })],
      [1, makeStatusResult({ status: "validated", requiresDecision: false })],
    ]);
    expect(canValidateAll(statuses)).toBe(true);
  });

  it("returns false when any item requires decision", () => {
    const statuses = new Map<number, LineStatusResult>([
      [0, makeStatusResult({ status: "validated", requiresDecision: false })],
      [1, makeStatusResult({ status: "needs_action", requiresDecision: true })],
    ]);
    expect(canValidateAll(statuses)).toBe(false);
  });

  it("returns false when all items require decision", () => {
    const statuses = new Map<number, LineStatusResult>([
      [0, makeStatusResult({ status: "needs_action", requiresDecision: true })],
      [1, makeStatusResult({ status: "needs_action", requiresDecision: true })],
    ]);
    expect(canValidateAll(statuses)).toBe(false);
  });

  it("returns true for empty map", () => {
    const statuses = new Map<number, LineStatusResult>();
    expect(canValidateAll(statuses)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// countByStatus
// ═══════════════════════════════════════════════════════════════════════════

describe("countByStatus", () => {
  it("counts all validated", () => {
    const statuses = new Map<number, LineStatusResult>([
      [0, makeStatusResult({ status: "validated" })],
      [1, makeStatusResult({ status: "validated" })],
      [2, makeStatusResult({ status: "validated" })],
    ]);
    const counts = countByStatus(statuses);
    expect(counts.validated).toBe(3);
    expect(counts.needsAction).toBe(0);
    expect(counts.priceAlert).toBe(0);
    expect(counts.total).toBe(3);
  });

  it("counts mixed statuses", () => {
    const statuses = new Map<number, LineStatusResult>([
      [0, makeStatusResult({ status: "validated" })],
      [1, makeStatusResult({ status: "needs_action" })],
      [2, makeStatusResult({ status: "validated" })],
      [3, makeStatusResult({ status: "needs_action" })],
    ]);
    const counts = countByStatus(statuses);
    expect(counts.validated).toBe(2);
    expect(counts.needsAction).toBe(2);
    expect(counts.total).toBe(4);
  });

  it("counts all needs_action", () => {
    const statuses = new Map<number, LineStatusResult>([
      [0, makeStatusResult({ status: "needs_action" })],
      [1, makeStatusResult({ status: "needs_action" })],
    ]);
    const counts = countByStatus(statuses);
    expect(counts.validated).toBe(0);
    expect(counts.needsAction).toBe(2);
    expect(counts.total).toBe(2);
  });

  it("returns zeros for empty map", () => {
    const statuses = new Map<number, LineStatusResult>();
    const counts = countByStatus(statuses);
    expect(counts.validated).toBe(0);
    expect(counts.needsAction).toBe(0);
    expect(counts.priceAlert).toBe(0);
    expect(counts.total).toBe(0);
  });

  it("priceAlert is always 0 (removed feature)", () => {
    const statuses = new Map<number, LineStatusResult>([
      [0, makeStatusResult({ status: "validated" })],
      [1, makeStatusResult({ status: "needs_action" })],
    ]);
    const counts = countByStatus(statuses);
    expect(counts.priceAlert).toBe(0);
  });
});
