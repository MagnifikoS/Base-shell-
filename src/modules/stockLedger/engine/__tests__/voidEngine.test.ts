/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VOID ENGINE — Extended Integration-Style Tests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ACTION-ITEMS.md reference: STK-LED-032 (P3 Testing)
 *
 * Tests the TypeScript void engine logic (prepareVoidEvents, verifyVoidBalance)
 * with emphasis on:
 * - Negative stock after void (conceptual: the DB fn should block this)
 * - Void idempotency (same inputs produce same outputs)
 * - Multi-product void correctness
 * - Precision edge cases
 * - Combined void + negative stock check workflow
 *
 * NOTE: The actual Postgres fn_void_stock_document is tested at DB level.
 * These tests cover the TypeScript pure functions that prepare void data.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from "vitest";
import { prepareVoidEvents, verifyVoidBalance } from "../voidEngine";
import { checkNegativeStock } from "../postGuards";
import type { StockEvent, StockDocument, StockDocumentLine } from "../../types";

// ═══════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

const UNIT_IDS = {
  pce: "unit-pce-001",
  kg: "unit-kg-002",
  L: "unit-l-004",
};

const ZONE_1 = "zone-frais-001";
const SNAPSHOT_1 = "snapshot-001";
const PRODUCT_A = "product-burrata-001";
const PRODUCT_B = "product-asiago-002";
const PRODUCT_C = "product-liquide-003";

function makePostedDoc(overrides?: Partial<StockDocument>): StockDocument {
  return {
    id: "doc-posted-001",
    establishment_id: "est-001",
    organization_id: "org-001",
    storage_zone_id: ZONE_1,
    supplier_id: null,
    type: "RECEIPT",
    status: "POSTED",
    idempotency_key: "key-001",
    lock_version: 2,
    created_by: "user-001",
    created_at: "2026-01-01T00:00:00Z",
    posted_at: "2026-01-01T00:00:00Z",
    posted_by: "user-001",
    voided_at: null,
    voided_by: null,
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEvent(
  overrides: Partial<StockEvent> & {
    id: string;
    product_id: string;
    delta_quantity_canonical: number;
  }
): StockEvent {
  return {
    establishment_id: "est-001",
    organization_id: "org-001",
    storage_zone_id: ZONE_1,
    document_id: "doc-posted-001",
    event_type: "RECEIPT",
    event_reason: "Reception BL",
    canonical_unit_id: UNIT_IDS.pce,
    canonical_family: "count",
    canonical_label: "Piece",
    context_hash: "abc12345",
    snapshot_version_id: SNAPSHOT_1,
    override_flag: false,
    override_reason: null,
    posted_at: "2026-01-01T00:00:00Z",
    posted_by: "user-001",
    voids_event_id: null,
    voids_document_id: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. VOID PREPARATION — Status Guards
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — Status Guards", () => {
  it("rejects DRAFT documents", () => {
    const doc = makePostedDoc({ status: "DRAFT" });
    const events = [makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 10 })];
    const result = prepareVoidEvents(doc, events, "void-1", "user-2", "test");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("DRAFT");
  });

  it("rejects VOID documents (already voided)", () => {
    const doc = makePostedDoc({ status: "VOID" });
    const events = [makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 10 })];
    const result = prepareVoidEvents(doc, events, "void-1", "user-2", "test");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("VOID");
  });

  it("rejects when no original events exist", () => {
    const doc = makePostedDoc();
    const result = prepareVoidEvents(doc, [], "void-1", "user-2", "test");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No events");
  });

  it("accepts POSTED documents with events", () => {
    const doc = makePostedDoc();
    const events = [makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 10 })];
    const result = prepareVoidEvents(doc, events, "void-1", "user-2", "test");
    expect(result.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. VOID PREPARATION — Delta Inversion
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — Delta Inversion", () => {
  it("inverts positive receipt delta to negative", () => {
    const doc = makePostedDoc();
    const events = [makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 24 })];
    const result = prepareVoidEvents(doc, events, "void-1", "user-2", "erreur");
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].delta_quantity_canonical).toBe(-24);
  });

  it("inverts negative withdrawal delta to positive", () => {
    const doc = makePostedDoc({ type: "WITHDRAWAL" });
    const events = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_A,
        delta_quantity_canonical: -15,
        event_type: "WITHDRAWAL",
      }),
    ];
    const result = prepareVoidEvents(doc, events, "void-1", "user-2", "erreur");
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].delta_quantity_canonical).toBe(15);
  });

  it("handles fractional deltas with 4-decimal precision", () => {
    const doc = makePostedDoc();
    const events = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 3.3333,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];
    const result = prepareVoidEvents(doc, events, "void-1", "user-2", "correction");
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].delta_quantity_canonical).toBe(-3.3333);
  });

  it("handles very small deltas without floating point drift", () => {
    const doc = makePostedDoc();
    const events = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 0.0001,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];
    const result = prepareVoidEvents(doc, events, "void-1", "user-2", "test");
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].delta_quantity_canonical).toBe(-0.0001);
  });

  it("handles zero delta (Math.round(-0) produces -0)", () => {
    const doc = makePostedDoc();
    const events = [makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 0 })];
    const result = prepareVoidEvents(doc, events, "void-1", "user-2", "test");
    expect(result.ok).toBe(true);
    // Note: -0 === 0 in JS, but Object.is(-0, 0) is false
    // The void engine produces -0 because Math.round(-0 * 10000) / 10000 = -0
    // This is mathematically correct (inverse of 0 is -0, which equals 0)
    expect(result.voidEvents![0].delta_quantity_canonical).toBe(-0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. VOID PREPARATION — Multi-Product Documents
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — Multi-Product Documents", () => {
  it("creates one void event per original event", () => {
    const doc = makePostedDoc();
    const events = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 24 }),
      makeEvent({
        id: "e2",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 3.5,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
      makeEvent({
        id: "e3",
        product_id: PRODUCT_C,
        delta_quantity_canonical: 20,
        canonical_unit_id: UNIT_IDS.L,
        canonical_family: "volume",
      }),
    ];
    const result = prepareVoidEvents(doc, events, "void-1", "user-2", "annulation totale");
    expect(result.ok).toBe(true);
    expect(result.voidEvents).toHaveLength(3);
    expect(result.voidEvents![0].delta_quantity_canonical).toBe(-24);
    expect(result.voidEvents![1].delta_quantity_canonical).toBe(-3.5);
    expect(result.voidEvents![2].delta_quantity_canonical).toBe(-20);
  });

  it("preserves correct voids_event_id references for each event", () => {
    const doc = makePostedDoc();
    const events = [
      makeEvent({ id: "evt-aaa", product_id: PRODUCT_A, delta_quantity_canonical: 10 }),
      makeEvent({
        id: "evt-bbb",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 5,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];
    const result = prepareVoidEvents(doc, events, "void-1", "user-2", "test");
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].voids_event_id).toBe("evt-aaa");
    expect(result.voidEvents![1].voids_event_id).toBe("evt-bbb");
  });

  it("all void events reference the original document", () => {
    const doc = makePostedDoc({ id: "doc-original-789" });
    const events = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_A,
        delta_quantity_canonical: 10,
        document_id: "doc-original-789",
      }),
      makeEvent({
        id: "e2",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 5,
        document_id: "doc-original-789",
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];
    const result = prepareVoidEvents(doc, events, "void-doc-new", "user-2", "test");
    expect(result.ok).toBe(true);
    for (const ve of result.voidEvents!) {
      expect(ve.voids_document_id).toBe("doc-original-789");
      expect(ve.document_id).toBe("void-doc-new");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. VOID PREPARATION — Metadata Preservation
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — Metadata Preservation", () => {
  it("preserves canonical_unit_id, family, label from original", () => {
    const doc = makePostedDoc();
    const events = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 5.75,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
        canonical_label: "Kilogramme",
      }),
    ];
    const result = prepareVoidEvents(doc, events, "v1", "u2", "test");
    expect(result.ok).toBe(true);
    const ve = result.voidEvents![0];
    expect(ve.canonical_unit_id).toBe(UNIT_IDS.kg);
    expect(ve.canonical_family).toBe("weight");
    expect(ve.canonical_label).toBe("Kilogramme");
  });

  it("preserves context_hash and snapshot_version_id", () => {
    const doc = makePostedDoc();
    const events = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_A,
        delta_quantity_canonical: 10,
        context_hash: "ctx-hash-xyz",
        snapshot_version_id: "snap-v42",
      }),
    ];
    const result = prepareVoidEvents(doc, events, "v1", "u2", "test");
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].context_hash).toBe("ctx-hash-xyz");
    expect(result.voidEvents![0].snapshot_version_id).toBe("snap-v42");
  });

  it("sets override_flag to false and override_reason to null on void events", () => {
    const doc = makePostedDoc();
    const events = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_A,
        delta_quantity_canonical: -50,
        override_flag: true,
        override_reason: "stock negatif accepte",
      }),
    ];
    const result = prepareVoidEvents(doc, events, "v1", "u2", "test");
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].override_flag).toBe(false);
    expect(result.voidEvents![0].override_reason).toBeNull();
  });

  it("sets posted_by to the voiding user, not the original poster", () => {
    const doc = makePostedDoc();
    const events = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_A,
        delta_quantity_canonical: 10,
        posted_by: "original-user",
      }),
    ];
    const result = prepareVoidEvents(doc, events, "v1", "voiding-user", "test");
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].posted_by).toBe("voiding-user");
  });

  it("sets event_reason to the provided void reason", () => {
    const doc = makePostedDoc();
    const events = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_A,
        delta_quantity_canonical: 10,
        event_reason: "Reception BL",
      }),
    ];
    const result = prepareVoidEvents(doc, events, "v1", "u2", "Erreur de saisie fournisseur");
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].event_reason).toBe("Erreur de saisie fournisseur");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. VOID IDEMPOTENCY — Same inputs produce same outputs
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — Idempotency", () => {
  it("produces identical void events for same inputs", () => {
    const doc = makePostedDoc();
    const events = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 24 }),
      makeEvent({
        id: "e2",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 3.5,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];

    const result1 = prepareVoidEvents(doc, events, "void-1", "user-2", "erreur");
    const result2 = prepareVoidEvents(doc, events, "void-1", "user-2", "erreur");

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    expect(result1.voidEvents).toEqual(result2.voidEvents);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. VERIFY VOID BALANCE
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — verifyVoidBalance", () => {
  it("balanced: single product, exact cancel", () => {
    const originals: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 50 }),
    ];
    const voids = [
      {
        establishment_id: "est-001",
        organization_id: "org-001",
        storage_zone_id: ZONE_1,
        product_id: PRODUCT_A,
        document_id: "v1",
        event_type: "VOID" as const,
        event_reason: "void",
        delta_quantity_canonical: -50,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: null,
        context_hash: "x",
        snapshot_version_id: SNAPSHOT_1,
        override_flag: false,
        override_reason: null,
        posted_by: "u1",
        voids_event_id: "e1",
        voids_document_id: "d1",
      },
    ];
    const check = verifyVoidBalance(originals, voids);
    expect(check.balanced).toBe(true);
    expect(check.discrepancies).toHaveLength(0);
  });

  it("balanced: multi-product, exact cancel", () => {
    const originals: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 24 }),
      makeEvent({
        id: "e2",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 3.5,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];
    const voids = [
      {
        establishment_id: "est-001",
        organization_id: "org-001",
        storage_zone_id: ZONE_1,
        product_id: PRODUCT_A,
        document_id: "v1",
        event_type: "VOID" as const,
        event_reason: "void",
        delta_quantity_canonical: -24,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: null,
        context_hash: "x",
        snapshot_version_id: SNAPSHOT_1,
        override_flag: false,
        override_reason: null,
        posted_by: "u1",
        voids_event_id: "e1",
        voids_document_id: "d1",
      },
      {
        establishment_id: "est-001",
        organization_id: "org-001",
        storage_zone_id: ZONE_1,
        product_id: PRODUCT_B,
        document_id: "v1",
        event_type: "VOID" as const,
        event_reason: "void",
        delta_quantity_canonical: -3.5,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
        canonical_label: null,
        context_hash: "x",
        snapshot_version_id: SNAPSHOT_1,
        override_flag: false,
        override_reason: null,
        posted_by: "u1",
        voids_event_id: "e2",
        voids_document_id: "d1",
      },
    ];
    const check = verifyVoidBalance(originals, voids);
    expect(check.balanced).toBe(true);
  });

  it("unbalanced: partial void (one product missing)", () => {
    const originals: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 24 }),
      makeEvent({
        id: "e2",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 3.5,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];
    // Only void product A, forget product B
    const voids = [
      {
        establishment_id: "est-001",
        organization_id: "org-001",
        storage_zone_id: ZONE_1,
        product_id: PRODUCT_A,
        document_id: "v1",
        event_type: "VOID" as const,
        event_reason: "void",
        delta_quantity_canonical: -24,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: null,
        context_hash: "x",
        snapshot_version_id: SNAPSHOT_1,
        override_flag: false,
        override_reason: null,
        posted_by: "u1",
        voids_event_id: "e1",
        voids_document_id: "d1",
      },
    ];
    const check = verifyVoidBalance(originals, voids);
    expect(check.balanced).toBe(false);
    expect(check.discrepancies).toHaveLength(1);
    expect(check.discrepancies[0]).toContain(PRODUCT_B);
  });

  it("unbalanced: wrong void amount", () => {
    const originals: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 24 }),
    ];
    const voids = [
      {
        establishment_id: "est-001",
        organization_id: "org-001",
        storage_zone_id: ZONE_1,
        product_id: PRODUCT_A,
        document_id: "v1",
        event_type: "VOID" as const,
        event_reason: "void",
        delta_quantity_canonical: -20,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: null,
        context_hash: "x",
        snapshot_version_id: SNAPSHOT_1,
        override_flag: false,
        override_reason: null,
        posted_by: "u1",
        voids_event_id: "e1",
        voids_document_id: "d1",
      },
    ];
    const check = verifyVoidBalance(originals, voids);
    expect(check.balanced).toBe(false);
    expect(check.discrepancies[0]).toContain("4");
  });

  it("balanced: prepareVoidEvents output always balances", () => {
    // Integration: use prepareVoidEvents then verify balance
    const doc = makePostedDoc();
    const originals: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 24 }),
      makeEvent({
        id: "e2",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 7.7777,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
      makeEvent({
        id: "e3",
        product_id: PRODUCT_C,
        delta_quantity_canonical: -15,
        canonical_unit_id: UNIT_IDS.L,
        canonical_family: "volume",
      }),
    ];
    const result = prepareVoidEvents(doc, originals, "void-doc", "user-2", "correction");
    expect(result.ok).toBe(true);
    const check = verifyVoidBalance(originals, result.voidEvents!);
    expect(check.balanced).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. VOID + NEGATIVE STOCK CHECK (Combined Workflow)
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — Negative Stock After Void", () => {
  it("voiding a receipt can cause negative stock when product has been consumed", () => {
    // Scenario: received 24 pcs, consumed 20, now void the receipt -> -20
    const doc = makePostedDoc();
    const originalReceiptEvents: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 24 }),
    ];

    // Prepare void events
    const voidResult = prepareVoidEvents(doc, originalReceiptEvents, "void-1", "u2", "test");
    expect(voidResult.ok).toBe(true);

    // Simulate current stock after consumption: 24 received - 20 consumed = 4 remaining
    const currentEstimates = new Map([[PRODUCT_A, 4]]);

    // Build document lines from void events for negative stock check
    const voidLines: StockDocumentLine[] = voidResult.voidEvents!.map((ve, i) => ({
      id: `vl-${i}`,
      document_id: "void-1",
      product_id: ve.product_id,
      input_payload: null,
      delta_quantity_canonical: ve.delta_quantity_canonical,
      canonical_unit_id: ve.canonical_unit_id,
      canonical_family: ve.canonical_family,
      canonical_label: ve.canonical_label,
      context_hash: ve.context_hash,
      created_at: "",
      updated_at: "",
    }));

    const negatives = checkNegativeStock(voidLines, currentEstimates);
    expect(negatives).toHaveLength(1);
    // 4 + (-24) = -20
    expect(negatives[0].resulting_stock).toBe(-20);
    expect(negatives[0].product_id).toBe(PRODUCT_A);
  });

  it("voiding a receipt with sufficient stock produces no negative", () => {
    const doc = makePostedDoc();
    const events: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 10 }),
    ];
    const voidResult = prepareVoidEvents(doc, events, "void-1", "u2", "test");
    expect(voidResult.ok).toBe(true);

    // Current stock = 30, void removes 10, resulting = 20 (positive)
    const currentEstimates = new Map([[PRODUCT_A, 30]]);
    const voidLines: StockDocumentLine[] = voidResult.voidEvents!.map((ve, i) => ({
      id: `vl-${i}`,
      document_id: "void-1",
      product_id: ve.product_id,
      input_payload: null,
      delta_quantity_canonical: ve.delta_quantity_canonical,
      canonical_unit_id: ve.canonical_unit_id,
      canonical_family: ve.canonical_family,
      canonical_label: ve.canonical_label,
      context_hash: ve.context_hash,
      created_at: "",
      updated_at: "",
    }));

    const negatives = checkNegativeStock(voidLines, currentEstimates);
    expect(negatives).toHaveLength(0);
  });

  it("voiding a withdrawal adds stock back (never negative)", () => {
    const doc = makePostedDoc({ type: "WITHDRAWAL" });
    const events: StockEvent[] = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_A,
        delta_quantity_canonical: -30,
        event_type: "WITHDRAWAL",
      }),
    ];
    const voidResult = prepareVoidEvents(doc, events, "void-1", "u2", "test");
    expect(voidResult.ok).toBe(true);
    // Void of withdrawal = +30
    expect(voidResult.voidEvents![0].delta_quantity_canonical).toBe(30);

    // Current stock = 70, void adds 30 back, resulting = 100
    const currentEstimates = new Map([[PRODUCT_A, 70]]);
    const voidLines: StockDocumentLine[] = voidResult.voidEvents!.map((ve, i) => ({
      id: `vl-${i}`,
      document_id: "void-1",
      product_id: ve.product_id,
      input_payload: null,
      delta_quantity_canonical: ve.delta_quantity_canonical,
      canonical_unit_id: ve.canonical_unit_id,
      canonical_family: ve.canonical_family,
      canonical_label: ve.canonical_label,
      context_hash: ve.context_hash,
      created_at: "",
      updated_at: "",
    }));

    const negatives = checkNegativeStock(voidLines, currentEstimates);
    expect(negatives).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. LARGE SCALE — Many Products Void + Balance Proof
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — Large Scale Multi-Product Balance Proof", () => {
  it("prepareVoidEvents + verifyVoidBalance stays balanced for 20 products", () => {
    const doc = makePostedDoc();
    const events: StockEvent[] = [];

    // Generate 20 distinct products with various deltas and unit families
    for (let i = 0; i < 20; i++) {
      const isWeight = i % 3 === 0;
      const isVolume = i % 3 === 1;
      events.push(
        makeEvent({
          id: `evt-large-${i}`,
          product_id: `product-large-${i}`,
          delta_quantity_canonical: (i + 1) * 1.1111,
          canonical_unit_id: isWeight ? UNIT_IDS.kg : isVolume ? UNIT_IDS.L : UNIT_IDS.pce,
          canonical_family: isWeight ? "weight" : isVolume ? "volume" : "count",
        })
      );
    }

    const result = prepareVoidEvents(doc, events, "void-large", "user-3", "bulk correction");
    expect(result.ok).toBe(true);
    expect(result.voidEvents).toHaveLength(20);

    // Every void event must have the exact negated delta
    for (let i = 0; i < 20; i++) {
      const originalDelta = events[i].delta_quantity_canonical;
      const voidDelta = result.voidEvents![i].delta_quantity_canonical;
      // Use toEqual(0) to avoid Object.is(-0, 0) being false
      const sum = Math.round((originalDelta + voidDelta) * 10000) / 10000;
      expect(sum === 0).toBe(true);
    }

    // verifyVoidBalance must confirm balance
    const check = verifyVoidBalance(events, result.voidEvents!);
    expect(check.balanced).toBe(true);
    expect(check.discrepancies).toHaveLength(0);
  });

  it("detects imbalance when one void delta is manually tampered", () => {
    const doc = makePostedDoc();
    const events: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 100 }),
      makeEvent({
        id: "e2",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 50,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
      makeEvent({
        id: "e3",
        product_id: PRODUCT_C,
        delta_quantity_canonical: 25,
        canonical_unit_id: UNIT_IDS.L,
        canonical_family: "volume",
      }),
    ];

    const result = prepareVoidEvents(doc, events, "void-tamper", "user-3", "test");
    expect(result.ok).toBe(true);

    // Tamper with one void event delta
    const tamperedVoids = result.voidEvents!.map((ve, i) => {
      if (i === 1) {
        return { ...ve, delta_quantity_canonical: -49 }; // should be -50
      }
      return ve;
    });

    const check = verifyVoidBalance(events, tamperedVoids);
    expect(check.balanced).toBe(false);
    expect(check.discrepancies).toHaveLength(1);
    expect(check.discrepancies[0]).toContain(PRODUCT_B);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. FLOATING POINT STRESS — Precision Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — Floating Point Precision Stress", () => {
  it("handles classic 0.1 + 0.2 floating point scenario", () => {
    const doc = makePostedDoc();
    const events: StockEvent[] = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 0.1,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
      makeEvent({
        id: "e2",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 0.2,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];

    const result = prepareVoidEvents(doc, events, "void-fp", "user-3", "test");
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].delta_quantity_canonical).toBe(-0.1);
    expect(result.voidEvents![1].delta_quantity_canonical).toBe(-0.2);

    const check = verifyVoidBalance(events, result.voidEvents!);
    expect(check.balanced).toBe(true);
  });

  it("handles repeating decimals that sum to whole number", () => {
    const doc = makePostedDoc();
    const events: StockEvent[] = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 0.3333,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
      makeEvent({
        id: "e2",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 0.6667,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];

    const result = prepareVoidEvents(doc, events, "void-rep", "user-3", "test");
    expect(result.ok).toBe(true);

    const check = verifyVoidBalance(events, result.voidEvents!);
    expect(check.balanced).toBe(true);
  });

  it("handles very large quantity (100000+)", () => {
    const doc = makePostedDoc();
    const events: StockEvent[] = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_A,
        delta_quantity_canonical: 123456.7891,
      }),
    ];

    const result = prepareVoidEvents(doc, events, "void-big", "user-3", "test");
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].delta_quantity_canonical).toBe(-123456.7891);

    const check = verifyVoidBalance(events, result.voidEvents!);
    expect(check.balanced).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. DOUBLE VOID GUARD — Conceptual: voiding an already-voided doc
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — Double Void Prevention", () => {
  it("rejects a document that has already been voided (status=VOID)", () => {
    const voidedDoc = makePostedDoc({
      status: "VOID",
      voided_at: "2026-01-02T00:00:00Z",
      voided_by: "user-001",
    });
    const events: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 10 }),
    ];

    const result = prepareVoidEvents(voidedDoc, events, "void-2", "user-3", "double void attempt");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("VOID");
    expect(result.error).toContain("Only POSTED");
  });

  it("rejects RECEIPT_CORRECTION status if it existed", () => {
    const doc = makePostedDoc({ status: "DRAFT" });
    const events: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 10 }),
    ];

    const result = prepareVoidEvents(doc, events, "void-3", "user-3", "test");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("DRAFT");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. VOID EVENT METADATA — Ensure all required fields are populated
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — Complete Metadata Validation", () => {
  it("all void events have required non-null fields", () => {
    const doc = makePostedDoc();
    const events: StockEvent[] = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_A,
        delta_quantity_canonical: 10,
        context_hash: "hash-abc",
        snapshot_version_id: SNAPSHOT_1,
      }),
      makeEvent({
        id: "e2",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 5.5,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
        canonical_label: "Kilogramme",
        context_hash: "hash-def",
        snapshot_version_id: SNAPSHOT_1,
      }),
    ];

    const result = prepareVoidEvents(doc, events, "void-meta", "user-void", "metadata test");
    expect(result.ok).toBe(true);

    for (const ve of result.voidEvents!) {
      // Required string fields must not be empty
      expect(ve.establishment_id).toBeTruthy();
      expect(ve.organization_id).toBeTruthy();
      expect(ve.storage_zone_id).toBeTruthy();
      expect(ve.product_id).toBeTruthy();
      expect(ve.document_id).toBe("void-meta");
      expect(ve.event_type).toBe("VOID");
      expect(ve.event_reason).toBe("metadata test");
      expect(ve.canonical_unit_id).toBeTruthy();
      expect(ve.canonical_family).toBeTruthy();
      expect(ve.context_hash).toBeTruthy();
      expect(ve.snapshot_version_id).toBeTruthy();
      expect(ve.posted_by).toBe("user-void");
      expect(ve.voids_event_id).toBeTruthy();
      expect(ve.voids_document_id).toBe(doc.id);
      // Override flags must be clean
      expect(ve.override_flag).toBe(false);
      expect(ve.override_reason).toBeNull();
    }
  });

  it("void events inherit establishment/organization from originals, not from doc", () => {
    // Edge case: what if event has different est/org (shouldn't happen, but test contract)
    const doc = makePostedDoc({ establishment_id: "est-doc", organization_id: "org-doc" });
    const events: StockEvent[] = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_A,
        delta_quantity_canonical: 10,
        establishment_id: "est-event",
        organization_id: "org-event",
      }),
    ];

    const result = prepareVoidEvents(doc, events, "void-inherit", "user-3", "test");
    expect(result.ok).toBe(true);
    // Void events should inherit from the ORIGINAL EVENTS, not the document
    expect(result.voidEvents![0].establishment_id).toBe("est-event");
    expect(result.voidEvents![0].organization_id).toBe("org-event");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. VOID ENGINE — ADJUSTMENT Document Type
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — Adjustment Document Void", () => {
  it("voids a POSTED ADJUSTMENT document correctly", () => {
    const doc = makePostedDoc({ type: "ADJUSTMENT" });
    const events: StockEvent[] = [
      makeEvent({
        id: "adj-e1",
        product_id: PRODUCT_A,
        delta_quantity_canonical: 5,
        event_type: "ADJUSTMENT",
      }),
      makeEvent({
        id: "adj-e2",
        product_id: PRODUCT_B,
        delta_quantity_canonical: -3,
        event_type: "ADJUSTMENT",
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];

    const result = prepareVoidEvents(
      doc,
      events,
      "void-adj-001",
      "user-adj",
      "correction inventaire"
    );
    expect(result.ok).toBe(true);
    expect(result.voidEvents).toHaveLength(2);
    expect(result.voidEvents![0].delta_quantity_canonical).toBe(-5);
    expect(result.voidEvents![1].delta_quantity_canonical).toBe(3);

    // Verify balance
    const check = verifyVoidBalance(events, result.voidEvents!);
    expect(check.balanced).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. VOID ENGINE — Storage Zone Preservation
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — Storage Zone Preservation", () => {
  it("preserves the original event storage_zone_id in void events", () => {
    const ZONE_OTHER = "zone-other-999";
    const doc = makePostedDoc({ storage_zone_id: ZONE_OTHER });
    const events: StockEvent[] = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_A,
        delta_quantity_canonical: 10,
        storage_zone_id: ZONE_1, // event has a different zone than the document
      }),
    ];

    const result = prepareVoidEvents(doc, events, "void-zone", "user-4", "test");
    expect(result.ok).toBe(true);
    // Void event should inherit zone from the original EVENT, not the document
    expect(result.voidEvents![0].storage_zone_id).toBe(ZONE_1);
  });

  it("handles events from multiple zones in same document", () => {
    const ZONE_X = "zone-x";
    const ZONE_Y = "zone-y";
    const doc = makePostedDoc();
    const events: StockEvent[] = [
      makeEvent({
        id: "e1",
        product_id: PRODUCT_A,
        delta_quantity_canonical: 10,
        storage_zone_id: ZONE_X,
      }),
      makeEvent({
        id: "e2",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 5,
        storage_zone_id: ZONE_Y,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];

    const result = prepareVoidEvents(doc, events, "void-multi-zone", "user-5", "test");
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].storage_zone_id).toBe(ZONE_X);
    expect(result.voidEvents![1].storage_zone_id).toBe(ZONE_Y);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. VOID ENGINE — Void Reason String Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — Void Reason Edge Cases", () => {
  it("handles empty string void reason", () => {
    const doc = makePostedDoc();
    const events: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 10 }),
    ];
    const result = prepareVoidEvents(doc, events, "void-1", "user-1", "");
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].event_reason).toBe("");
  });

  it("handles very long void reason", () => {
    const longReason = "A".repeat(1000);
    const doc = makePostedDoc();
    const events: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 10 }),
    ];
    const result = prepareVoidEvents(doc, events, "void-1", "user-1", longReason);
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].event_reason).toBe(longReason);
  });

  it("handles void reason with special characters", () => {
    const specialReason = 'Erreur: "quantité" > 100 & < 0 — réf. #123';
    const doc = makePostedDoc();
    const events: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 10 }),
    ];
    const result = prepareVoidEvents(doc, events, "void-1", "user-1", specialReason);
    expect(result.ok).toBe(true);
    expect(result.voidEvents![0].event_reason).toBe(specialReason);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. VERIFY VOID BALANCE — Multi-Event Same Product
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — verifyVoidBalance — Multi-Event Same Product", () => {
  it("balanced when same product has multiple original events, all voided", () => {
    const originals: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 10 }),
      makeEvent({ id: "e2", product_id: PRODUCT_A, delta_quantity_canonical: 15 }),
      makeEvent({ id: "e3", product_id: PRODUCT_A, delta_quantity_canonical: 5 }),
    ];
    // Total for PRODUCT_A = 30

    const doc = makePostedDoc();
    const voidResult = prepareVoidEvents(doc, originals, "void-multi", "user-3", "test");
    expect(voidResult.ok).toBe(true);

    const check = verifyVoidBalance(originals, voidResult.voidEvents!);
    expect(check.balanced).toBe(true);
  });

  it("unbalanced when one void event is missing from multi-event product", () => {
    const originals: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 10 }),
      makeEvent({ id: "e2", product_id: PRODUCT_A, delta_quantity_canonical: 15 }),
    ];

    // Only void the first event, skip the second
    const partialVoids = [
      {
        establishment_id: "est-001",
        organization_id: "org-001",
        storage_zone_id: ZONE_1,
        product_id: PRODUCT_A,
        document_id: "v1",
        event_type: "VOID" as const,
        event_reason: "partial void",
        delta_quantity_canonical: -10,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: "Piece",
        context_hash: "abc12345",
        snapshot_version_id: SNAPSHOT_1,
        override_flag: false,
        override_reason: null,
        posted_by: "u1",
        voids_event_id: "e1",
        voids_document_id: "d1",
      },
    ];

    const check = verifyVoidBalance(originals, partialVoids);
    expect(check.balanced).toBe(false);
    expect(check.discrepancies).toHaveLength(1);
    expect(check.discrepancies[0]).toContain(PRODUCT_A);
    expect(check.discrepancies[0]).toContain("15"); // residual = 25 - 10 = 15
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. VOID + NEGATIVE STOCK — Multi-Product Complex Scenario
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — Complex Multi-Product Negative Stock After Void", () => {
  it("mixed scenario: some products go negative, some dont", () => {
    const doc = makePostedDoc();
    const events: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 100 }),
      makeEvent({
        id: "e2",
        product_id: PRODUCT_B,
        delta_quantity_canonical: 50,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];

    const voidResult = prepareVoidEvents(doc, events, "void-complex", "user-5", "test");
    expect(voidResult.ok).toBe(true);

    // Product A: had 100 received, consumed 80, current = 20
    // Void removes 100 -> 20 - 100 = -80 (negative!)
    // Product B: had 50 received, consumed 10, current = 40
    // Void removes 50 -> 40 - 50 = -10 (negative!)
    const currentEstimates = new Map([
      [PRODUCT_A, 20],
      [PRODUCT_B, 40],
    ]);

    const voidLines: StockDocumentLine[] = voidResult.voidEvents!.map((ve, i) => ({
      id: `vl-${i}`,
      document_id: "void-complex",
      product_id: ve.product_id,
      input_payload: null,
      delta_quantity_canonical: ve.delta_quantity_canonical,
      canonical_unit_id: ve.canonical_unit_id,
      canonical_family: ve.canonical_family,
      canonical_label: ve.canonical_label,
      context_hash: ve.context_hash,
      created_at: "",
      updated_at: "",
    }));

    const negatives = checkNegativeStock(voidLines, currentEstimates);
    expect(negatives).toHaveLength(2);

    const negA = negatives.find((n) => n.product_id === PRODUCT_A);
    expect(negA).toBeDefined();
    expect(negA!.resulting_stock).toBe(-80);

    const negB = negatives.find((n) => n.product_id === PRODUCT_B);
    expect(negB).toBeDefined();
    expect(negB!.resulting_stock).toBe(-10);
  });

  it("voiding a receipt when no consumption happened: no negative stock", () => {
    const doc = makePostedDoc();
    const events: StockEvent[] = [
      makeEvent({ id: "e1", product_id: PRODUCT_A, delta_quantity_canonical: 50 }),
    ];

    const voidResult = prepareVoidEvents(doc, events, "void-safe", "user-5", "test");
    expect(voidResult.ok).toBe(true);

    // Product A: received 50, no consumption, current = 50
    const currentEstimates = new Map([[PRODUCT_A, 50]]);

    const voidLines: StockDocumentLine[] = voidResult.voidEvents!.map((ve, i) => ({
      id: `vl-${i}`,
      document_id: "void-safe",
      product_id: ve.product_id,
      input_payload: null,
      delta_quantity_canonical: ve.delta_quantity_canonical,
      canonical_unit_id: ve.canonical_unit_id,
      canonical_family: ve.canonical_family,
      canonical_label: ve.canonical_label,
      context_hash: ve.context_hash,
      created_at: "",
      updated_at: "",
    }));

    const negatives = checkNegativeStock(voidLines, currentEstimates);
    expect(negatives).toHaveLength(0);
  });
});
