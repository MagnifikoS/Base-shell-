/**
 * Tests for releveReconciliationService.ts — Releve Reconciliation Pure Functions
 *
 * Covers:
 *   1. inferPeriod — period inference from header, line dates, issue_date, fallback
 *   2. normalizeInvoiceNumber — invoice ref normalization for fuzzy matching
 *   3. amountsMatch — amount comparison with tolerance
 *   4. findBestMatch — multi-strategy matching (reference, amount+date fallback)
 */

import { describe, it, expect, vi } from "vitest";
import type { ReleveHeader, ReleveLine } from "../types/releveTypes";

// Mock supabase client (required by the module even though we test pure functions)
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          ilike: () => ({
            is: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
          gte: () => ({
            lte: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  },
}));

import { _testInternals } from "../services/releveReconciliationService";

const { normalizeInvoiceNumber, amountsMatch, inferPeriod, findBestMatch } = _testInternals;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeHeader(overrides: Partial<ReleveHeader> = {}): ReleveHeader {
  return {
    supplier_name: "Test Supplier",
    supplier_account_ref: null,
    period_start: null,
    period_end: null,
    previous_balance: null,
    total_invoiced: null,
    total_credits: null,
    total_payments: null,
    balance_due: null,
    issue_date: null,
    ...overrides,
  };
}

function makeLine(overrides: Partial<ReleveLine> = {}): ReleveLine {
  return {
    line_type: "invoice",
    reference: null,
    date: null,
    description: null,
    amount_ht: null,
    amount_ttc: null,
    amount_tva: null,
    due_date: null,
    is_credit: false,
    field_confidence: { reference: 0.9, amount_ttc: 0.9, date: 0.9 },
    ...overrides,
  };
}

interface TestDbInvoiceRow {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  amount_eur: number;
  is_paid: boolean;
  supplier_id: string;
  supplier_name: string | null;
}

function makeDbInvoice(overrides: Partial<TestDbInvoiceRow> = {}): TestDbInvoiceRow {
  return {
    id: "inv-001",
    invoice_number: "FA-001",
    invoice_date: "2026-01-15",
    amount_eur: 100.0,
    is_paid: false,
    supplier_id: "sup-001",
    supplier_name: "Test Supplier",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// normalizeInvoiceNumber
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeInvoiceNumber", () => {
  it("should uppercase and remove dashes", () => {
    // Removes dashes and uppercases; leading zeros only stripped from start of string
    expect(normalizeInvoiceNumber("fa-001")).toBe("FA001");
  });

  it("should remove spaces", () => {
    expect(normalizeInvoiceNumber("FA 001")).toBe("FA001");
  });

  it("should remove dots, slashes, underscores", () => {
    expect(normalizeInvoiceNumber("FA.001/A_B")).toBe("FA001AB");
  });

  it("should strip leading zeros from start of string", () => {
    expect(normalizeInvoiceNumber("00123")).toBe("123");
  });

  it("FA-001, FA001, FA 001 all normalize to the same value", () => {
    const n1 = normalizeInvoiceNumber("FA-001");
    const n2 = normalizeInvoiceNumber("FA001");
    const n3 = normalizeInvoiceNumber("FA 001");
    expect(n1).toBe(n2);
    expect(n2).toBe(n3);
    expect(n1).toBe("FA001");
  });

  it("should handle 001 vs FA-001 (different after normalization)", () => {
    const n1 = normalizeInvoiceNumber("001");
    const n2 = normalizeInvoiceNumber("FA-001");
    // "001" normalizes to "1" (leading zeros stripped), "FA-001" normalizes to "FA001"
    expect(n1).toBe("1");
    expect(n2).toBe("FA001");
    expect(n1).not.toBe(n2);
  });

  it("should handle mixed case", () => {
    expect(normalizeInvoiceNumber("fa-001")).toBe(normalizeInvoiceNumber("FA-001"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// amountsMatch
// ─────────────────────────────────────────────────────────────────────────────

describe("amountsMatch", () => {
  it("should match exact amounts", () => {
    expect(amountsMatch(100.0, 100.0)).toBe(true);
  });

  it("should match within tolerance (0.01)", () => {
    // Use values that avoid floating-point edge cases at exactly 0.01 difference
    expect(amountsMatch(100.0, 100.005)).toBe(true);
    expect(amountsMatch(100.005, 100.0)).toBe(true);
    expect(amountsMatch(50.0, 50.0)).toBe(true);
  });

  it("should NOT match beyond tolerance", () => {
    expect(amountsMatch(100.0, 100.02)).toBe(false);
    expect(amountsMatch(100.0, 99.98)).toBe(false);
    expect(amountsMatch(100.0, 100.05)).toBe(false);
  });

  it("should match zero amounts", () => {
    expect(amountsMatch(0, 0)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// inferPeriod
// ─────────────────────────────────────────────────────────────────────────────

describe("inferPeriod", () => {
  it("Priority 1: uses explicit header period_start and period_end", () => {
    const header = makeHeader({
      period_start: "2026-01-01",
      period_end: "2026-01-31",
    });
    const result = inferPeriod(header, []);
    expect(result).toEqual({ start: "2026-01-01", end: "2026-01-31" });
  });

  it("Priority 2: infers from line dates when header period is null", () => {
    const header = makeHeader(); // period_start and period_end are null
    const lines = [makeLine({ date: "2026-01-10" }), makeLine({ date: "2026-01-25" })];
    const result = inferPeriod(header, lines);
    expect(result.start).toBe("2026-01-01");
    expect(result.end).toBe("2026-01-31");
  });

  it("Priority 2: spans multiple months when lines cross months", () => {
    const header = makeHeader();
    const lines = [makeLine({ date: "2026-01-15" }), makeLine({ date: "2026-02-10" })];
    const result = inferPeriod(header, lines);
    expect(result.start).toBe("2026-01-01");
    expect(result.end).toBe("2026-02-28");
  });

  it("Priority 2: does NOT mix partial header values with computed bounds", () => {
    // header has period_start but NOT period_end → should still use computed bounds
    const header = makeHeader({ period_start: "2026-03-15" }); // period_end is null
    const lines = [makeLine({ date: "2026-01-10" }), makeLine({ date: "2026-01-25" })];
    const result = inferPeriod(header, lines);
    // Should use computed bounds from line dates, NOT the partial header value
    expect(result.start).toBe("2026-01-01");
    expect(result.end).toBe("2026-01-31");
  });

  it("Priority 2: ignores null dates in lines", () => {
    const header = makeHeader();
    const lines = [
      makeLine({ date: null }),
      makeLine({ date: "2026-03-15" }),
      makeLine({ date: null }),
    ];
    const result = inferPeriod(header, lines);
    expect(result.start).toBe("2026-03-01");
    expect(result.end).toBe("2026-03-31");
  });

  it("Priority 3: uses header issue_date when no line dates available", () => {
    const header = makeHeader({ issue_date: "2026-04-15" });
    const result = inferPeriod(header, []);
    expect(result.start).toBe("2026-04-01");
    expect(result.end).toBe("2026-04-30");
  });

  it("Priority 4: falls back to current month when nothing else is available", () => {
    const header = makeHeader();
    const result = inferPeriod(header, []);
    // Just check it returns a valid period object (current month varies)
    expect(result.start).toMatch(/^\d{4}-\d{2}-01$/);
    expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("Releve from January → period correctly inferred as January range", () => {
    const header = makeHeader();
    const lines = [
      makeLine({ date: "2026-01-05" }),
      makeLine({ date: "2026-01-20" }),
      makeLine({ date: "2026-01-31" }),
    ];
    const result = inferPeriod(header, lines);
    expect(result.start).toBe("2026-01-01");
    expect(result.end).toBe("2026-01-31");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findBestMatch
// ─────────────────────────────────────────────────────────────────────────────

describe("findBestMatch", () => {
  it("exact match: reference + amount + date all match", () => {
    const releveLine = makeLine({
      reference: "FA-001",
      amount_ttc: 100.0,
      date: "2026-01-15",
    });
    const dbInvoices = [
      makeDbInvoice({
        id: "inv-001",
        invoice_number: "FA-001",
        amount_eur: 100.0,
        invoice_date: "2026-01-15",
      }),
    ];
    const result = findBestMatch(releveLine, dbInvoices, new Set());
    expect(result).not.toBeNull();
    expect(result!.status).toBe("exact_match");
    expect(result!.db_invoice.id).toBe("inv-001");
  });

  it("normalized reference match: FA-001 in releve matches FA001 in DB", () => {
    const releveLine = makeLine({
      reference: "FA-001",
      amount_ttc: 100.0,
      date: "2026-01-15",
    });
    const dbInvoices = [
      makeDbInvoice({
        id: "inv-001",
        invoice_number: "FA001",
        amount_eur: 100.0,
        invoice_date: "2026-01-15",
      }),
    ];
    const result = findBestMatch(releveLine, dbInvoices, new Set());
    expect(result).not.toBeNull();
    expect(result!.status).toBe("exact_match");
  });

  it("normalized reference match: FA 001 matches FA-001", () => {
    const releveLine = makeLine({
      reference: "FA 001",
      amount_ttc: 100.0,
      date: "2026-01-15",
    });
    const dbInvoices = [
      makeDbInvoice({
        id: "inv-001",
        invoice_number: "FA-001",
        amount_eur: 100.0,
        invoice_date: "2026-01-15",
      }),
    ];
    const result = findBestMatch(releveLine, dbInvoices, new Set());
    expect(result).not.toBeNull();
    expect(result!.status).toBe("exact_match");
  });

  it("amount mismatch: reference matches but amounts differ", () => {
    const releveLine = makeLine({
      reference: "FA-001",
      amount_ttc: 150.0,
      date: "2026-01-15",
    });
    const dbInvoices = [
      makeDbInvoice({
        id: "inv-001",
        invoice_number: "FA-001",
        amount_eur: 100.0,
        invoice_date: "2026-01-15",
      }),
    ];
    const result = findBestMatch(releveLine, dbInvoices, new Set());
    expect(result).not.toBeNull();
    expect(result!.status).toBe("amount_mismatch");
    expect(result!.amount_difference).toBe(50.0);
  });

  it("date mismatch: reference + amount match but dates differ", () => {
    const releveLine = makeLine({
      reference: "FA-001",
      amount_ttc: 100.0,
      date: "2026-01-20",
    });
    const dbInvoices = [
      makeDbInvoice({
        id: "inv-001",
        invoice_number: "FA-001",
        amount_eur: 100.0,
        invoice_date: "2026-01-15",
      }),
    ];
    const result = findBestMatch(releveLine, dbInvoices, new Set());
    expect(result).not.toBeNull();
    expect(result!.status).toBe("date_mismatch");
  });

  it("partial match: reference matches but amount and date are null", () => {
    const releveLine = makeLine({
      reference: "FA-001",
      amount_ttc: null,
      date: null,
    });
    const dbInvoices = [
      makeDbInvoice({
        id: "inv-001",
        invoice_number: "FA-001",
      }),
    ];
    const result = findBestMatch(releveLine, dbInvoices, new Set());
    expect(result).not.toBeNull();
    expect(result!.status).toBe("partial_match");
  });

  it("no match: reference does not match and amount+date also differ", () => {
    const releveLine = makeLine({
      reference: "FA-999",
      amount_ttc: 200.0,
      date: "2026-02-20",
    });
    const dbInvoices = [
      makeDbInvoice({
        id: "inv-001",
        invoice_number: "FA-001",
        amount_eur: 100.0,
        invoice_date: "2026-01-15",
      }),
    ];
    const result = findBestMatch(releveLine, dbInvoices, new Set());
    expect(result).toBeNull();
  });

  it("ref mismatch but same amount+date: fallback matches by amount+date", () => {
    const releveLine = makeLine({
      reference: "FA-999",
      amount_ttc: 100.0,
      date: "2026-01-15",
    });
    const dbInvoices = [
      makeDbInvoice({
        id: "inv-001",
        invoice_number: "FA-001",
        amount_eur: 100.0,
        invoice_date: "2026-01-15",
      }),
    ];
    const result = findBestMatch(releveLine, dbInvoices, new Set());
    // Strategy 1 (reference) fails, but Strategy 2 (amount+date) succeeds
    expect(result).not.toBeNull();
    expect(result!.status).toBe("partial_match");
    expect(result!.notes).toContain("reference absente");
  });

  it("skips already matched DB invoices", () => {
    const releveLine = makeLine({
      reference: "FA-001",
      amount_ttc: 100.0,
      date: "2026-01-15",
    });
    const dbInvoices = [
      makeDbInvoice({
        id: "inv-001",
        invoice_number: "FA-001",
        amount_eur: 100.0,
        invoice_date: "2026-01-15",
      }),
    ];
    const alreadyMatched = new Set(["inv-001"]);
    const result = findBestMatch(releveLine, dbInvoices, alreadyMatched);
    expect(result).toBeNull();
  });

  it("fallback: matches by amount + date when reference is null", () => {
    const releveLine = makeLine({
      reference: null,
      amount_ttc: 250.0,
      date: "2026-01-15",
    });
    const dbInvoices = [
      makeDbInvoice({
        id: "inv-001",
        invoice_number: "FA-001",
        amount_eur: 250.0,
        invoice_date: "2026-01-15",
      }),
    ];
    const result = findBestMatch(releveLine, dbInvoices, new Set());
    expect(result).not.toBeNull();
    expect(result!.status).toBe("partial_match");
    expect(result!.notes).toContain("reference absente");
    expect(result!.db_invoice.id).toBe("inv-001");
  });

  it("fallback: no match when reference is null and amount+date don't match", () => {
    const releveLine = makeLine({
      reference: null,
      amount_ttc: 250.0,
      date: "2026-01-15",
    });
    const dbInvoices = [
      makeDbInvoice({
        id: "inv-001",
        invoice_number: "FA-001",
        amount_eur: 300.0,
        invoice_date: "2026-01-15",
      }),
    ];
    const result = findBestMatch(releveLine, dbInvoices, new Set());
    expect(result).toBeNull();
  });

  it("fallback: no match when reference and amount are null", () => {
    const releveLine = makeLine({
      reference: null,
      amount_ttc: null,
      date: "2026-01-15",
    });
    const dbInvoices = [makeDbInvoice({ id: "inv-001" })];
    const result = findBestMatch(releveLine, dbInvoices, new Set());
    expect(result).toBeNull();
  });

  it("invoice in releve but not DB → returns null (missing_from_db)", () => {
    const releveLine = makeLine({
      reference: "FA-999",
      amount_ttc: 500.0,
      date: "2026-01-15",
    });
    // Empty DB
    const result = findBestMatch(releveLine, [], new Set());
    expect(result).toBeNull();
  });

  it("multiple DB invoices: picks first matching reference", () => {
    const releveLine = makeLine({
      reference: "FA-001",
      amount_ttc: 100.0,
      date: "2026-01-15",
    });
    const dbInvoices = [
      makeDbInvoice({
        id: "inv-other",
        invoice_number: "FA-999",
        amount_eur: 100.0,
        invoice_date: "2026-01-15",
      }),
      makeDbInvoice({
        id: "inv-match",
        invoice_number: "FA-001",
        amount_eur: 100.0,
        invoice_date: "2026-01-15",
      }),
    ];
    const result = findBestMatch(releveLine, dbInvoices, new Set());
    expect(result).not.toBeNull();
    expect(result!.db_invoice.id).toBe("inv-match");
    expect(result!.status).toBe("exact_match");
  });
});
