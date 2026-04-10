/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DUPLICATE INVOICE DETECTION — Unit Tests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests the 3 detection strategies:
 * 1. EXACT: supplier_id + invoice_number + invoice_date
 * 2. ROBUST: supplier_id + invoice_date + invoice_total
 * 3. FUZZY: supplier_id + invoice_date + |total_diff| <= 0.50 + |items_diff| <= 1
 *
 * Plus: null supplier guard (not_checked)
 */

import { describe, it, expect } from "vitest";
import { detectDuplicateInvoice } from "../detectDuplicateInvoice";
import type { InvoiceRecord } from "../../types";

const makeInvoice = (overrides?: Partial<InvoiceRecord>): InvoiceRecord => ({
  id: "inv-001",
  invoice_number: "FAC-2026-001",
  invoice_date: "2026-01-15",
  supplier_id: "sup-001",
  amount_eur: 1250.5,
  items_count: 12,
  ...overrides,
});

describe("detectDuplicateInvoice", () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // GUARD: null supplier_id
  // ═══════════════════════════════════════════════════════════════════════════

  describe("supplier guard", () => {
    it("returns not_checked when supplierId is null", () => {
      const result = detectDuplicateInvoice({
        supplierId: null,
        invoiceNumber: "FAC-001",
        invoiceDate: "2026-01-15",
        invoiceTotal: 100,
        itemsCount: 5,
        existingInvoices: [makeInvoice()],
      });
      expect(result.status).toBe("not_checked");
      expect(result.isDuplicate).toBeNull();
      expect(result.reason).toBeNull();
    });

    it("never returns isDuplicate: false when supplierId is null", () => {
      const result = detectDuplicateInvoice({
        supplierId: null,
        invoiceNumber: null,
        invoiceDate: null,
        invoiceTotal: null,
        itemsCount: 0,
        existingInvoices: [],
      });
      expect(result.isDuplicate).not.toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STRATEGY 1: EXACT MATCH
  // ═══════════════════════════════════════════════════════════════════════════

  describe("exact match (supplier_id + invoice_number + invoice_date)", () => {
    it("detects exact match", () => {
      const existing = [makeInvoice()];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: "FAC-2026-001",
        invoiceDate: "2026-01-15",
        invoiceTotal: 9999, // different total, still matches
        itemsCount: 99,
        existingInvoices: existing,
      });
      expect(result.status).toBe("checked");
      expect(result.isDuplicate).toBe(true);
      expect(result.reason).toBe("exact_match");
      expect(result.existingInvoice?.id).toBe("inv-001");
    });

    it("is case-insensitive on invoice_number", () => {
      const existing = [makeInvoice({ invoice_number: "fac-2026-001" })];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: "FAC-2026-001",
        invoiceDate: "2026-01-15",
        invoiceTotal: null,
        itemsCount: 0,
        existingInvoices: existing,
      });
      expect(result.isDuplicate).toBe(true);
      expect(result.reason).toBe("exact_match");
    });

    it("trims whitespace from invoice_number", () => {
      const existing = [makeInvoice({ invoice_number: " FAC-001 " })];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: "FAC-001",
        invoiceDate: "2026-01-15",
        invoiceTotal: null,
        itemsCount: 0,
        existingInvoices: existing,
      });
      expect(result.isDuplicate).toBe(true);
    });

    it("does not match different supplier", () => {
      const existing = [makeInvoice({ supplier_id: "sup-002" })];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: "FAC-2026-001",
        invoiceDate: "2026-01-15",
        invoiceTotal: 1250.5,
        itemsCount: 12,
        existingInvoices: existing,
      });
      expect(result.isDuplicate).toBe(false);
    });

    it("does not match different date even with same number", () => {
      const existing = [makeInvoice()];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: "FAC-2026-001",
        invoiceDate: "2026-02-15", // different date
        invoiceTotal: 1250.5,
        itemsCount: 12,
        existingInvoices: existing,
      });
      // Exact match requires both number + date
      // Falls through to robust/fuzzy
      expect(result.reason).not.toBe("exact_match");
    });

    it("skips exact match when invoiceNumber is null", () => {
      const existing = [makeInvoice()];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: null,
        invoiceDate: "2026-01-15",
        invoiceTotal: 1250.5,
        itemsCount: 12,
        existingInvoices: existing,
      });
      // Should still find via robust or fuzzy, not exact
      if (result.isDuplicate) {
        expect(result.reason).not.toBe("exact_match");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STRATEGY 2: ROBUST MATCH
  // ═══════════════════════════════════════════════════════════════════════════

  describe("robust match (supplier_id + invoice_date + invoice_total)", () => {
    it("detects robust match", () => {
      const existing = [makeInvoice({ invoice_number: null })]; // no number to match on
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: null,
        invoiceDate: "2026-01-15",
        invoiceTotal: 1250.5,
        itemsCount: 0,
        existingInvoices: existing,
      });
      expect(result.isDuplicate).toBe(true);
      expect(result.reason).toBe("robust_match");
    });

    it("does not match different total", () => {
      const existing = [makeInvoice({ invoice_number: null })];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: null,
        invoiceDate: "2026-01-15",
        invoiceTotal: 1250.51, // off by 0.01
        itemsCount: 12,
        existingInvoices: existing,
      });
      // Robust requires exact total match; falls through to fuzzy
      expect(result.reason).not.toBe("robust_match");
    });

    it("skips robust match when invoiceTotal is null", () => {
      const existing = [makeInvoice({ invoice_number: null })];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: null,
        invoiceDate: "2026-01-15",
        invoiceTotal: null,
        itemsCount: 12,
        existingInvoices: existing,
      });
      expect(result.isDuplicate).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STRATEGY 3: FUZZY MATCH
  // ═══════════════════════════════════════════════════════════════════════════

  describe("fuzzy match (supplier_id + date + ~total + ~items_count)", () => {
    it("detects fuzzy match with total within 0.50 tolerance", () => {
      // Use a total that differs slightly so robust_match doesn't fire first
      const existing = [makeInvoice({ invoice_number: null, amount_eur: 100.0, items_count: 5 })];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: null,
        invoiceDate: "2026-01-15",
        invoiceTotal: 100.49, // within 0.50 tolerance, but != 100.00 so robust won't fire
        itemsCount: 5,
        existingInvoices: existing,
      });
      expect(result.isDuplicate).toBe(true);
      expect(result.reason).toBe("fuzzy_match");
    });

    it("rejects fuzzy match when total difference > 0.50", () => {
      const existing = [makeInvoice({ invoice_number: null, amount_eur: 100.0, items_count: 5 })];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: null,
        invoiceDate: "2026-01-15",
        invoiceTotal: 100.51, // exceeds 0.50 tolerance
        itemsCount: 5,
        existingInvoices: existing,
      });
      expect(result.isDuplicate).toBe(false);
    });

    it("accepts fuzzy match with items_count difference of 1", () => {
      // Use a total that differs slightly so robust_match doesn't fire first
      const existing = [makeInvoice({ invoice_number: null, amount_eur: 100.0, items_count: 5 })];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: null,
        invoiceDate: "2026-01-15",
        invoiceTotal: 100.2, // close enough for fuzzy (within 0.50), but != exact for robust
        itemsCount: 6, // off by 1
        existingInvoices: existing,
      });
      expect(result.isDuplicate).toBe(true);
      expect(result.reason).toBe("fuzzy_match");
    });

    it("rejects fuzzy match when items_count difference > 1", () => {
      // Use a total that differs slightly so robust_match doesn't fire first
      const existing = [makeInvoice({ invoice_number: null, amount_eur: 100.0, items_count: 5 })];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: null,
        invoiceDate: "2026-01-15",
        invoiceTotal: 100.2, // close enough for fuzzy, but != exact for robust
        itemsCount: 7, // off by 2 — exceeds items tolerance
        existingInvoices: existing,
      });
      expect(result.isDuplicate).toBe(false);
    });

    it("skips fuzzy match when itemsCount is 0", () => {
      // Use slightly different total so robust won't match
      const existing = [makeInvoice({ invoice_number: null, amount_eur: 100.0, items_count: 5 })];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: null,
        invoiceDate: "2026-01-15",
        invoiceTotal: 100.1, // close for fuzzy, but fuzzy guard requires itemsCount > 0
        itemsCount: 0, // guard condition
        existingInvoices: existing,
      });
      // Robust won't match (100.10 != 100.00), fuzzy skipped (itemsCount = 0)
      expect(result.isDuplicate).toBe(false);
    });

    it("exact total match with same date is caught by robust before fuzzy", () => {
      // When total matches exactly, robust_match fires first
      const existing = [makeInvoice({ invoice_number: null, amount_eur: 100.0, items_count: 5 })];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: null,
        invoiceDate: "2026-01-15",
        invoiceTotal: 100.0,
        itemsCount: 5,
        existingInvoices: existing,
      });
      expect(result.isDuplicate).toBe(true);
      // Robust fires first because total is exactly the same
      expect(result.reason).toBe("robust_match");
    });

    it("matches fuzzy when existing invoice has no items_count", () => {
      // Use slightly different total so robust won't match
      const existing = [
        makeInvoice({ invoice_number: null, amount_eur: 100.0, items_count: undefined }),
      ];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: null,
        invoiceDate: "2026-01-15",
        invoiceTotal: 100.3, // different from 100.00 so robust won't fire
        itemsCount: 5,
        existingInvoices: existing,
      });
      // When existing has no items_count, the items comparison is skipped
      expect(result.isDuplicate).toBe(true);
      expect(result.reason).toBe("fuzzy_match");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NO DUPLICATE FOUND
  // ═══════════════════════════════════════════════════════════════════════════

  describe("no duplicate found", () => {
    it("returns checked + false when no match", () => {
      const existing = [makeInvoice({ supplier_id: "sup-999" })];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: "DIFFERENT",
        invoiceDate: "2099-12-31",
        invoiceTotal: 999999,
        itemsCount: 99,
        existingInvoices: existing,
      });
      expect(result.status).toBe("checked");
      expect(result.isDuplicate).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.existingInvoice).toBeNull();
    });

    it("returns checked + false when existing invoices array is empty", () => {
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: "FAC-001",
        invoiceDate: "2026-01-15",
        invoiceTotal: 100,
        itemsCount: 5,
        existingInvoices: [],
      });
      expect(result.status).toBe("checked");
      expect(result.isDuplicate).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY ORDER
  // ═══════════════════════════════════════════════════════════════════════════

  describe("priority order", () => {
    it("prefers exact_match over robust_match", () => {
      const existing = [makeInvoice()]; // matches all 3 strategies
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: "FAC-2026-001",
        invoiceDate: "2026-01-15",
        invoiceTotal: 1250.5,
        itemsCount: 12,
        existingInvoices: existing,
      });
      expect(result.reason).toBe("exact_match");
    });

    it("falls to robust_match when no exact match possible", () => {
      const existing = [makeInvoice()];
      const result = detectDuplicateInvoice({
        supplierId: "sup-001",
        invoiceNumber: null, // no number to compare
        invoiceDate: "2026-01-15",
        invoiceTotal: 1250.5,
        itemsCount: 12,
        existingInvoices: existing,
      });
      expect(result.reason).toBe("robust_match");
    });
  });
});
