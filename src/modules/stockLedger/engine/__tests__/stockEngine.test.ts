/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STOCK ENGINE — TESTS MATHÉMATIQUES COMPLETS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Scénarios testés:
 * 1. Burrata (Fixed Weight) — Carton → Boîte → Pièce (1 pce = 50g), canonical=pce
 * 2. Asiago (Variable Weight) — Billed kg, no fixed equiv, canonical=kg
 * 3. Liquides — Bidon → Bouteille → Litre, canonical=L
 * 4. Packaging multi-niveaux — Pack → Pièce, canonical=pce
 * 5. Edge cases — empty events, null quantity, zero delta, precision
 * 6. Family mismatch — cross-family rejection
 * 7. Negative stock — detection
 * 8. Context hash — determinism
 * 9. Post guards — all validations
 * 10. Void engine — exact inversion & balance
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from "vitest";
import {
  getEstimatedStock,
  getEstimatedStockBatch,
} from "../stockEngine";
import type { UnitFamilyResolver, SnapshotLine } from "../stockEngine";
import type { StockEvent, StockDocument } from "../../types";
import { computeContextHash } from "../contextHash";
import type { ContextHashInput } from "../../types";
import { validatePrePost, checkNegativeStock, generateIdempotencyKey } from "../postGuards";
import type { StockDocumentLine, ZoneStockSnapshot } from "../../types";
import { prepareVoidEvents, verifyVoidBalance } from "../voidEngine";

// ═══════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

const UNIT_IDS = {
  pce: "unit-pce-001",
  kg: "unit-kg-002",
  g: "unit-g-003",
  L: "unit-l-004",
  carton: "unit-carton-005",
  boite: "unit-boite-006",
  bouteille: "unit-bouteille-007",
  bidon: "unit-bidon-008",
  pack: "unit-pack-009",
};

const FAMILIES: Record<string, string> = {
  [UNIT_IDS.pce]: "count",
  [UNIT_IDS.kg]: "weight",
  [UNIT_IDS.g]: "weight",
  [UNIT_IDS.L]: "volume",
  [UNIT_IDS.carton]: "packaging",
  [UNIT_IDS.boite]: "packaging",
  [UNIT_IDS.bouteille]: "packaging",
  [UNIT_IDS.bidon]: "packaging",
  [UNIT_IDS.pack]: "packaging",
};

const LABELS: Record<string, string> = {
  [UNIT_IDS.pce]: "Pièce (pce)",
  [UNIT_IDS.kg]: "Kilogramme (kg)",
  [UNIT_IDS.g]: "Gramme (g)",
  [UNIT_IDS.L]: "Litre (L)",
  [UNIT_IDS.carton]: "Carton (crt)",
  [UNIT_IDS.boite]: "Boîte (bte)",
  [UNIT_IDS.bouteille]: "Bouteille (btl)",
  [UNIT_IDS.bidon]: "Bidon (bid)",
  [UNIT_IDS.pack]: "Pack (pk)",
};

const unitResolver: UnitFamilyResolver = {
  getFamily: (id: string) => FAMILIES[id] ?? null,
  getLabel: (id: string) => LABELS[id] ?? null,
};

const PRODUCT_A = "product-burrata-001";
const PRODUCT_B = "product-asiago-002";
const PRODUCT_C = "product-liquide-003";
const PRODUCT_D = "product-pack-004";
const ZONE_1 = "zone-frais-001";
const _ZONE_2 = "zone-sec-002";
const SNAPSHOT_1 = "snapshot-001";

function makeEvent(
  overrides: Partial<StockEvent> & {
    delta_quantity_canonical: number;
    canonical_unit_id: string;
    canonical_family: string;
  }
): Pick<StockEvent, "delta_quantity_canonical" | "canonical_unit_id" | "canonical_family"> {
  return {
    delta_quantity_canonical: overrides.delta_quantity_canonical,
    canonical_unit_id: overrides.canonical_unit_id,
    canonical_family: overrides.canonical_family,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. BURRATA — Fixed Weight (canonical = pce)
// ═══════════════════════════════════════════════════════════════════════════

describe("StockEngine — Burrata (Fixed Weight, canonical=pce)", () => {
  const snapshotLine: SnapshotLine = {
    product_id: PRODUCT_A,
    quantity: 120, // 120 pièces au dernier inventaire
    unit_id: UNIT_IDS.pce,
  };

  it("returns snapshot quantity when no events", () => {
    const result = getEstimatedStock(PRODUCT_A, ZONE_1, SNAPSHOT_1, snapshotLine, [], unitResolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.snapshot_quantity).toBe(120);
    expect(result.data.events_delta).toBe(0);
    expect(result.data.estimated_quantity).toBe(120);
    expect(result.data.canonical_unit_id).toBe(UNIT_IDS.pce);
    expect(result.data.canonical_family).toBe("count");
    expect(result.data.events_count).toBe(0);
  });

  it("adds receipt events correctly", () => {
    const events = [
      makeEvent({
        delta_quantity_canonical: 24,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
      makeEvent({
        delta_quantity_canonical: 12,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
    ];
    const result = getEstimatedStock(
      PRODUCT_A,
      ZONE_1,
      SNAPSHOT_1,
      snapshotLine,
      events,
      unitResolver
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.snapshot_quantity).toBe(120);
    expect(result.data.events_delta).toBe(36);
    expect(result.data.estimated_quantity).toBe(156);
    expect(result.data.events_count).toBe(2);
  });

  it("subtracts withdrawal events correctly", () => {
    const events = [
      makeEvent({
        delta_quantity_canonical: -30,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
    ];
    const result = getEstimatedStock(
      PRODUCT_A,
      ZONE_1,
      SNAPSHOT_1,
      snapshotLine,
      events,
      unitResolver
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.estimated_quantity).toBe(90);
  });

  it("handles mixed receipt and withdrawal", () => {
    const events = [
      makeEvent({
        delta_quantity_canonical: 24,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
      makeEvent({
        delta_quantity_canonical: -10,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
      makeEvent({
        delta_quantity_canonical: 6,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
      makeEvent({
        delta_quantity_canonical: -50,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
    ];
    const result = getEstimatedStock(
      PRODUCT_A,
      ZONE_1,
      SNAPSHOT_1,
      snapshotLine,
      events,
      unitResolver
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 120 + 24 - 10 + 6 - 50 = 90
    expect(result.data.estimated_quantity).toBe(90);
    expect(result.data.events_count).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. ASIAGO — Variable Weight (canonical = kg)
// ═══════════════════════════════════════════════════════════════════════════

describe("StockEngine — Asiago (Variable Weight, canonical=kg)", () => {
  const snapshotLine: SnapshotLine = {
    product_id: PRODUCT_B,
    quantity: 15.5, // 15.5 kg au dernier inventaire
    unit_id: UNIT_IDS.kg,
  };

  it("handles fractional kg quantities correctly", () => {
    const events = [
      makeEvent({
        delta_quantity_canonical: 3.25,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
      makeEvent({
        delta_quantity_canonical: -1.7,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];
    const result = getEstimatedStock(
      PRODUCT_B,
      ZONE_1,
      SNAPSHOT_1,
      snapshotLine,
      events,
      unitResolver
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 15.5 + 3.25 - 1.7 = 17.05
    expect(result.data.estimated_quantity).toBe(17.05);
    expect(result.data.canonical_family).toBe("weight");
  });

  it("maintains 4-decimal precision", () => {
    const events = [
      makeEvent({
        delta_quantity_canonical: 0.3333,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
      makeEvent({
        delta_quantity_canonical: 0.6667,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];
    const result = getEstimatedStock(
      PRODUCT_B,
      ZONE_1,
      SNAPSHOT_1,
      snapshotLine,
      events,
      unitResolver
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 15.5 + 0.3333 + 0.6667 = 16.5
    expect(result.data.estimated_quantity).toBe(16.5);
  });

  it("ignores count-family events on weight-canonical product (warning, not error)", () => {
    const events = [
      makeEvent({
        delta_quantity_canonical: 5,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
    ];
    const result = getEstimatedStock(
      PRODUCT_B,
      ZONE_1,
      SNAPSHOT_1,
      snapshotLine,
      events,
      unitResolver
    );
    // Engine filters incompatible events and returns snapshot qty with warning
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.estimated_quantity).toBe(15.5); // snapshot only, events ignored
      expect(result.data.warnings.length).toBeGreaterThan(0);
      expect(result.data.warnings[0].code).toBe("IGNORED_EVENTS_FAMILY_MISMATCH");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. LIQUIDES (canonical = L)
// ═══════════════════════════════════════════════════════════════════════════

describe("StockEngine — Liquides (canonical=L)", () => {
  const snapshotLine: SnapshotLine = {
    product_id: PRODUCT_C,
    quantity: 50, // 50 litres
    unit_id: UNIT_IDS.L,
  };

  it("handles volume quantities", () => {
    const events = [
      makeEvent({
        delta_quantity_canonical: 20,
        canonical_unit_id: UNIT_IDS.L,
        canonical_family: "volume",
      }),
      makeEvent({
        delta_quantity_canonical: -15.5,
        canonical_unit_id: UNIT_IDS.L,
        canonical_family: "volume",
      }),
    ];
    const result = getEstimatedStock(
      PRODUCT_C,
      ZONE_1,
      SNAPSHOT_1,
      snapshotLine,
      events,
      unitResolver
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 50 + 20 - 15.5 = 54.5
    expect(result.data.estimated_quantity).toBe(54.5);
    expect(result.data.canonical_family).toBe("volume");
  });

  it("ignores weight-family events on volume-canonical product (warning, not error)", () => {
    const events = [
      makeEvent({
        delta_quantity_canonical: 5,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];
    const result = getEstimatedStock(
      PRODUCT_C,
      ZONE_1,
      SNAPSHOT_1,
      snapshotLine,
      events,
      unitResolver
    );
    // Engine filters incompatible events and returns snapshot qty with warning
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.estimated_quantity).toBe(50); // snapshot only, events ignored
      expect(result.data.warnings.length).toBeGreaterThan(0);
      expect(result.data.warnings[0].code).toBe("IGNORED_EVENTS_FAMILY_MISMATCH");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. PACKAGING MULTI-NIVEAUX (canonical = pce)
// ═══════════════════════════════════════════════════════════════════════════

describe("StockEngine — Packaging multi-niveaux (canonical=pce)", () => {
  const snapshotLine: SnapshotLine = {
    product_id: PRODUCT_D,
    quantity: 200, // 200 pièces
    unit_id: UNIT_IDS.pce,
  };

  it("handles large receipt deltas (converted from packs)", () => {
    // 5 packs × 24 pce = 120 pce already converted to canonical at POST time
    const events = [
      makeEvent({
        delta_quantity_canonical: 120,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
    ];
    const result = getEstimatedStock(
      PRODUCT_D,
      ZONE_1,
      SNAPSHOT_1,
      snapshotLine,
      events,
      unitResolver
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.estimated_quantity).toBe(320);
  });

  it("handles negative resulting stock", () => {
    const events = [
      makeEvent({
        delta_quantity_canonical: -250,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
    ];
    const result = getEstimatedStock(
      PRODUCT_D,
      ZONE_1,
      SNAPSHOT_1,
      snapshotLine,
      events,
      unitResolver
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // -50 — engine computes, override check is separate
    expect(result.data.estimated_quantity).toBe(-50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe("StockEngine — Edge Cases", () => {
  it("returns error when snapshot line is null", () => {
    const result = getEstimatedStock(PRODUCT_A, ZONE_1, SNAPSHOT_1, null, [], unitResolver);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.code).toBe("NO_SNAPSHOT_LINE");
    }
  });

  it("returns error when snapshot line has null unit_id", () => {
    const result = getEstimatedStock(
      PRODUCT_A,
      ZONE_1,
      SNAPSHOT_1,
      { product_id: PRODUCT_A, quantity: 10, unit_id: null },
      [],
      unitResolver
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.code).toBe("MISSING_UNIT_INFO");
    }
  });

  it("handles null snapshot quantity as 0", () => {
    const result = getEstimatedStock(
      PRODUCT_A,
      ZONE_1,
      SNAPSHOT_1,
      { product_id: PRODUCT_A, quantity: null, unit_id: UNIT_IDS.pce },
      [
        makeEvent({
          delta_quantity_canonical: 10,
          canonical_unit_id: UNIT_IDS.pce,
          canonical_family: "count",
        }),
      ],
      unitResolver
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.snapshot_quantity).toBe(0);
    expect(result.data.estimated_quantity).toBe(10);
  });

  it("handles zero delta events", () => {
    const events = [
      makeEvent({
        delta_quantity_canonical: 0,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
    ];
    const result = getEstimatedStock(
      PRODUCT_A,
      ZONE_1,
      SNAPSHOT_1,
      { product_id: PRODUCT_A, quantity: 100, unit_id: UNIT_IDS.pce },
      events,
      unitResolver
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.estimated_quantity).toBe(100);
    expect(result.data.events_count).toBe(1);
  });

  it("returns error for unknown unit family", () => {
    const result = getEstimatedStock(
      PRODUCT_A,
      ZONE_1,
      SNAPSHOT_1,
      { product_id: PRODUCT_A, quantity: 10, unit_id: "unknown-unit-999" },
      [],
      unitResolver
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.code).toBe("MISSING_UNIT_INFO");
    }
  });

  it("precision: avoids floating point drift", () => {
    const events = [
      makeEvent({
        delta_quantity_canonical: 0.1,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
      makeEvent({
        delta_quantity_canonical: 0.2,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
      makeEvent({
        delta_quantity_canonical: 0.3,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      }),
    ];
    const result = getEstimatedStock(
      PRODUCT_B,
      ZONE_1,
      SNAPSHOT_1,
      { product_id: PRODUCT_B, quantity: 0, unit_id: UNIT_IDS.kg },
      events,
      unitResolver
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 0.1 + 0.2 + 0.3 = 0.6 (must not be 0.6000000000000001)
    expect(result.data.estimated_quantity).toBe(0.6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. BATCH
// ═══════════════════════════════════════════════════════════════════════════

describe("StockEngine — Batch", () => {
  it("computes multiple products in one call", () => {
    const results = getEstimatedStockBatch(
      ZONE_1,
      SNAPSHOT_1,
      [
        {
          product_id: PRODUCT_A,
          snapshotLine: { product_id: PRODUCT_A, quantity: 100, unit_id: UNIT_IDS.pce },
          events: [
            makeEvent({
              delta_quantity_canonical: 10,
              canonical_unit_id: UNIT_IDS.pce,
              canonical_family: "count",
            }),
          ],
        },
        {
          product_id: PRODUCT_B,
          snapshotLine: { product_id: PRODUCT_B, quantity: 5.5, unit_id: UNIT_IDS.kg },
          events: [
            makeEvent({
              delta_quantity_canonical: -2.0,
              canonical_unit_id: UNIT_IDS.kg,
              canonical_family: "weight",
            }),
          ],
        },
        {
          product_id: PRODUCT_C,
          snapshotLine: null, // no snapshot line
          events: [],
        },
      ],
      unitResolver
    );

    expect(results.size).toBe(3);

    const a = results.get(PRODUCT_A);
    expect(a?.ok).toBe(true);
    if (a?.ok) expect(a.data.estimated_quantity).toBe(110);

    const b = results.get(PRODUCT_B);
    expect(b?.ok).toBe(true);
    if (b?.ok) expect(b.data.estimated_quantity).toBe(3.5);

    const c = results.get(PRODUCT_C);
    expect(c?.ok).toBe(false);
    if (c && c.ok === false) expect(c.error.code).toBe("NO_SNAPSHOT_LINE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. CONTEXT HASH — DETERMINISM
// ═══════════════════════════════════════════════════════════════════════════

describe("Context Hash — Determinism", () => {
  const baseInput: ContextHashInput = {
    canonical_unit_id: UNIT_IDS.pce,
    billing_unit_id: UNIT_IDS.kg,
    packaging_levels: [
      { type_unit_id: UNIT_IDS.carton, contains_unit_id: UNIT_IDS.boite, quantity: 4 },
      { type_unit_id: UNIT_IDS.boite, contains_unit_id: UNIT_IDS.pce, quantity: 6 },
    ],
    equivalence: { source_unit_id: UNIT_IDS.pce, unit_id: UNIT_IDS.g, quantity: 50 },
  };

  it("produces same hash for same input", () => {
    const h1 = computeContextHash(baseInput);
    const h2 = computeContextHash(baseInput);
    expect(h1).toBe(h2);
  });

  it("produces same hash regardless of packaging level order", () => {
    const reversed: ContextHashInput = {
      ...baseInput,
      packaging_levels: [...baseInput.packaging_levels].reverse(),
    };
    expect(computeContextHash(baseInput)).toBe(computeContextHash(reversed));
  });

  it("produces different hash for different canonical unit", () => {
    const different: ContextHashInput = {
      ...baseInput,
      canonical_unit_id: UNIT_IDS.kg,
    };
    expect(computeContextHash(baseInput)).not.toBe(computeContextHash(different));
  });

  it("produces different hash for different equivalence", () => {
    const different: ContextHashInput = {
      ...baseInput,
      equivalence: { source_unit_id: UNIT_IDS.pce, unit_id: UNIT_IDS.g, quantity: 100 },
    };
    expect(computeContextHash(baseInput)).not.toBe(computeContextHash(different));
  });

  it("produces different hash with no equivalence", () => {
    const noEquiv: ContextHashInput = { ...baseInput, equivalence: null };
    expect(computeContextHash(baseInput)).not.toBe(computeContextHash(noEquiv));
  });

  it("hash is always 8 hex chars", () => {
    const hash = computeContextHash(baseInput);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. POST GUARDS
// ═══════════════════════════════════════════════════════════════════════════

describe("Post Guards — validatePrePost", () => {
  const baseDoc: StockDocument = {
    id: "doc-001",
    establishment_id: "est-001",
    organization_id: "org-001",
    storage_zone_id: ZONE_1,
    supplier_id: null,
    type: "RECEIPT",
    status: "DRAFT",
    idempotency_key: null,
    lock_version: 1,
    created_by: "user-001",
    created_at: "",
    posted_at: null,
    posted_by: null,
    voided_at: null,
    voided_by: null,
    updated_at: "",
  };
  const baseLine: StockDocumentLine = {
    id: "line-001",
    document_id: "doc-001",
    product_id: PRODUCT_A,
    input_payload: null,
    delta_quantity_canonical: 10,
    canonical_unit_id: UNIT_IDS.pce,
    canonical_family: "count",
    canonical_label: "Pièce",
    context_hash: "abc12345",
    created_at: "",
    updated_at: "",
  };
  const baseSnapshot: ZoneStockSnapshot = {
    id: "zss-001",
    establishment_id: "est-001",
    organization_id: "org-001",
    storage_zone_id: ZONE_1,
    snapshot_version_id: SNAPSHOT_1,
    activated_at: "",
    activated_by: null,
    created_at: "",
    updated_at: "",
  };

  it("passes with valid input", () => {
    const result = validatePrePost({
      document: baseDoc,
      lines: [baseLine],
      zoneSnapshot: baseSnapshot,
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails if document is not DRAFT", () => {
    const result = validatePrePost({
      document: { ...baseDoc, status: "POSTED" },
      lines: [baseLine],
      zoneSnapshot: baseSnapshot,
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("POSTED");
  });

  it("fails if no active snapshot (P0-C)", () => {
    const result = validatePrePost({
      document: baseDoc,
      lines: [baseLine],
      zoneSnapshot: null,
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("snapshot actif");
  });

  it("fails on lock_version mismatch (optimistic locking)", () => {
    const result = validatePrePost({
      document: { ...baseDoc, lock_version: 3 },
      lines: [baseLine],
      zoneSnapshot: baseSnapshot,
      expectedLockVersion: 2,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("modifié ailleurs");
  });

  it("fails if no lines", () => {
    const result = validatePrePost({
      document: baseDoc,
      lines: [],
      zoneSnapshot: baseSnapshot,
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("aucune ligne");
  });

  it("accumulates multiple errors", () => {
    const result = validatePrePost({
      document: { ...baseDoc, status: "POSTED", lock_version: 5 },
      lines: [],
      zoneSnapshot: null,
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Post Guards — checkNegativeStock (deprecated, kept for compat)", () => {
  it("detects negative stock", () => {
    const lines: StockDocumentLine[] = [
      {
        id: "l1",
        document_id: "d1",
        product_id: PRODUCT_A,
        input_payload: null,
        delta_quantity_canonical: -50,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: null,
        context_hash: "x",
        created_at: "",
        updated_at: "",
      },
    ];
    const estimates = new Map([[PRODUCT_A, 30]]);
    const negatives = checkNegativeStock(lines, estimates);
    expect(negatives).toHaveLength(1);
    expect(negatives[0].resulting_stock).toBe(-20);
  });

  it("returns empty for positive stock", () => {
    const lines: StockDocumentLine[] = [
      {
        id: "l1",
        document_id: "d1",
        product_id: PRODUCT_A,
        input_payload: null,
        delta_quantity_canonical: 10,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: null,
        context_hash: "x",
        created_at: "",
        updated_at: "",
      },
    ];
    const estimates = new Map([[PRODUCT_A, 30]]);
    expect(checkNegativeStock(lines, estimates)).toHaveLength(0);
  });
});

describe("Post Guards — generateIdempotencyKey", () => {
  it("generates unique keys for different documents", () => {
    const k1 = generateIdempotencyKey("doc-1", "est-1", 0);
    const k2 = generateIdempotencyKey("doc-2", "est-1", 0);
    // Different document IDs → different keys
    expect(k1).not.toBe(k2);
  });

  it("starts with 'post_'", () => {
    const key = generateIdempotencyKey("doc-1", "est-1", 0);
    expect(key.startsWith("post_")).toBe(true);
  });

  it("is deterministic — same inputs produce same key (STK-LED-030)", () => {
    const k1 = generateIdempotencyKey("doc-1", "est-1", 3);
    const k2 = generateIdempotencyKey("doc-1", "est-1", 3);
    expect(k1).toBe(k2);
    expect(k1).toBe("post_est-1_doc-1_v3");
  });

  it("different lock_version produces different key", () => {
    const k1 = generateIdempotencyKey("doc-1", "est-1", 0);
    const k2 = generateIdempotencyKey("doc-1", "est-1", 1);
    expect(k1).not.toBe(k2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. VOID ENGINE
// ═══════════════════════════════════════════════════════════════════════════

describe("Void Engine — prepareVoidEvents", () => {
  const postedDoc: StockDocument = {
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
    created_at: "",
    posted_at: "2026-01-01T00:00:00Z",
    posted_by: "user-001",
    voided_at: null,
    voided_by: null,
    updated_at: "",
  };

  const originalEvents: StockEvent[] = [
    {
      id: "evt-001",
      establishment_id: "est-001",
      organization_id: "org-001",
      storage_zone_id: ZONE_1,
      product_id: PRODUCT_A,
      document_id: "doc-posted-001",
      event_type: "RECEIPT",
      event_reason: "Réception BL",
      delta_quantity_canonical: 24,
      canonical_unit_id: UNIT_IDS.pce,
      canonical_family: "count",
      canonical_label: "Pièce",
      context_hash: "abc12345",
      snapshot_version_id: SNAPSHOT_1,
      override_flag: false,
      override_reason: null,
      posted_at: "2026-01-01T00:00:00Z",
      posted_by: "user-001",
      voids_event_id: null,
      voids_document_id: null,
      created_at: "",
    },
    {
      id: "evt-002",
      establishment_id: "est-001",
      organization_id: "org-001",
      storage_zone_id: ZONE_1,
      product_id: PRODUCT_B,
      document_id: "doc-posted-001",
      event_type: "RECEIPT",
      event_reason: "Réception BL",
      delta_quantity_canonical: 3.5,
      canonical_unit_id: UNIT_IDS.kg,
      canonical_family: "weight",
      canonical_label: "Kilogramme",
      context_hash: "def67890",
      snapshot_version_id: SNAPSHOT_1,
      override_flag: false,
      override_reason: null,
      posted_at: "2026-01-01T00:00:00Z",
      posted_by: "user-001",
      voids_event_id: null,
      voids_document_id: null,
      created_at: "",
    },
  ];

  it("creates exact inverse events", () => {
    const result = prepareVoidEvents(
      postedDoc,
      originalEvents,
      "void-doc-001",
      "user-002",
      "Erreur de saisie"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.voidEvents).toHaveLength(2);
    expect(result.voidEvents![0].delta_quantity_canonical).toBe(-24);
    expect(result.voidEvents![1].delta_quantity_canonical).toBe(-3.5);
    expect(result.voidEvents![0].event_type).toBe("VOID");
    expect(result.voidEvents![0].voids_event_id).toBe("evt-001");
    expect(result.voidEvents![0].voids_document_id).toBe("doc-posted-001");
  });

  it("rejects non-POSTED documents", () => {
    const draft = { ...postedDoc, status: "DRAFT" as const };
    const result = prepareVoidEvents(draft, originalEvents, "v1", "u1", "test");
    expect(result.ok).toBe(false);
  });

  it("rejects documents with no events", () => {
    const result = prepareVoidEvents(postedDoc, [], "v1", "u1", "test");
    expect(result.ok).toBe(false);
  });
});

describe("Void Engine — verifyVoidBalance", () => {
  it("confirms balance when void exactly cancels", () => {
    const originals: StockEvent[] = [
      {
        id: "e1",
        establishment_id: "est-001",
        organization_id: "org-001",
        storage_zone_id: ZONE_1,
        product_id: PRODUCT_A,
        document_id: "d1",
        event_type: "RECEIPT",
        event_reason: "test",
        delta_quantity_canonical: 24.5,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: null,
        context_hash: "x",
        snapshot_version_id: SNAPSHOT_1,
        override_flag: false,
        override_reason: null,
        posted_at: "",
        posted_by: null,
        voids_event_id: null,
        voids_document_id: null,
        created_at: "",
      },
    ];
    const voids = [
      {
        establishment_id: "est-001",
        organization_id: "org-001",
        storage_zone_id: ZONE_1,
        product_id: PRODUCT_A,
        document_id: "v1",
        event_type: "VOID" as const,
        event_reason: "annulation",
        delta_quantity_canonical: -24.5,
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

  it("detects imbalanced void", () => {
    const originals: StockEvent[] = [
      {
        id: "e1",
        establishment_id: "est-001",
        organization_id: "org-001",
        storage_zone_id: ZONE_1,
        product_id: PRODUCT_A,
        document_id: "d1",
        event_type: "RECEIPT",
        event_reason: "test",
        delta_quantity_canonical: 24.5,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: null,
        context_hash: "x",
        snapshot_version_id: SNAPSHOT_1,
        override_flag: false,
        override_reason: null,
        posted_at: "",
        posted_by: null,
        voids_event_id: null,
        voids_document_id: null,
        created_at: "",
      },
    ];
    const voids = [
      {
        establishment_id: "est-001",
        organization_id: "org-001",
        storage_zone_id: ZONE_1,
        product_id: PRODUCT_A,
        document_id: "v1",
        event_type: "VOID" as const,
        event_reason: "annulation",
        delta_quantity_canonical: -20, // WRONG — should be -24.5
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
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. BATCH — Extended Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe("StockEngine — Batch Extended", () => {
  it("returns empty map for empty input array", () => {
    const results = getEstimatedStockBatch(ZONE_1, SNAPSHOT_1, [], unitResolver);
    expect(results.size).toBe(0);
  });

  it("handles single item batch correctly", () => {
    const results = getEstimatedStockBatch(
      ZONE_1,
      SNAPSHOT_1,
      [
        {
          product_id: PRODUCT_A,
          snapshotLine: { product_id: PRODUCT_A, quantity: 50, unit_id: UNIT_IDS.pce },
          events: [],
        },
      ],
      unitResolver
    );
    expect(results.size).toBe(1);
    const a = results.get(PRODUCT_A);
    expect(a?.ok).toBe(true);
    if (a?.ok) expect(a.data.estimated_quantity).toBe(50);
  });

  it("handles batch where all products have errors", () => {
    const results = getEstimatedStockBatch(
      ZONE_1,
      SNAPSHOT_1,
      [
        { product_id: PRODUCT_A, snapshotLine: null, events: [] },
        { product_id: PRODUCT_B, snapshotLine: null, events: [] },
        { product_id: PRODUCT_C, snapshotLine: null, events: [] },
      ],
      unitResolver
    );
    expect(results.size).toBe(3);
    for (const [, result] of results) {
      expect(result.ok).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!result.ok) expect((result as any).error.code).toBe("NO_SNAPSHOT_LINE");
    }
  });

  it("handles batch with mixed families (each correct for its product)", () => {
    const results = getEstimatedStockBatch(
      ZONE_1,
      SNAPSHOT_1,
      [
        {
          product_id: PRODUCT_A,
          snapshotLine: { product_id: PRODUCT_A, quantity: 100, unit_id: UNIT_IDS.pce },
          events: [
            makeEvent({
              delta_quantity_canonical: 10,
              canonical_unit_id: UNIT_IDS.pce,
              canonical_family: "count",
            }),
          ],
        },
        {
          product_id: PRODUCT_B,
          snapshotLine: { product_id: PRODUCT_B, quantity: 5.5, unit_id: UNIT_IDS.kg },
          events: [
            makeEvent({
              delta_quantity_canonical: 2.5,
              canonical_unit_id: UNIT_IDS.kg,
              canonical_family: "weight",
            }),
          ],
        },
        {
          product_id: PRODUCT_C,
          snapshotLine: { product_id: PRODUCT_C, quantity: 20, unit_id: UNIT_IDS.L },
          events: [
            makeEvent({
              delta_quantity_canonical: -5,
              canonical_unit_id: UNIT_IDS.L,
              canonical_family: "volume",
            }),
          ],
        },
      ],
      unitResolver
    );
    expect(results.size).toBe(3);

    const a = results.get(PRODUCT_A);
    expect(a?.ok).toBe(true);
    if (a?.ok) expect(a.data.estimated_quantity).toBe(110);

    const b = results.get(PRODUCT_B);
    expect(b?.ok).toBe(true);
    if (b?.ok) expect(b.data.estimated_quantity).toBe(8);

    const c = results.get(PRODUCT_C);
    expect(c?.ok).toBe(true);
    if (c?.ok) expect(c.data.estimated_quantity).toBe(15);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. STOCK ENGINE — Large Number of Events
// ═══════════════════════════════════════════════════════════════════════════

describe("StockEngine — Large Event Sequences", () => {
  it("handles 100 small receipt events without precision drift", () => {
    const events = Array.from({ length: 100 }, () =>
      makeEvent({
        delta_quantity_canonical: 0.01,
        canonical_unit_id: UNIT_IDS.kg,
        canonical_family: "weight",
      })
    );
    const result = getEstimatedStock(
      PRODUCT_B,
      ZONE_1,
      SNAPSHOT_1,
      { product_id: PRODUCT_B, quantity: 0, unit_id: UNIT_IDS.kg },
      events,
      unitResolver
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100 * 0.01 = 1.0 exactly (no floating point drift)
    expect(result.data.estimated_quantity).toBe(1);
    expect(result.data.events_count).toBe(100);
  });

  it("handles alternating receipt and withdrawal events", () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      makeEvent({
        delta_quantity_canonical: i % 2 === 0 ? 10 : -5,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      })
    );
    const result = getEstimatedStock(
      PRODUCT_A,
      ZONE_1,
      SNAPSHOT_1,
      { product_id: PRODUCT_A, quantity: 0, unit_id: UNIT_IDS.pce },
      events,
      unitResolver
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 25 receipts of 10 = 250, 25 withdrawals of 5 = 125, net = 125
    expect(result.data.estimated_quantity).toBe(125);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. POST GUARDS — Withdrawal Document Type
// ═══════════════════════════════════════════════════════════════════════════

describe("Post Guards — Withdrawal Document Validation", () => {
  const withdrawalDoc: StockDocument = {
    id: "doc-w-001",
    establishment_id: "est-001",
    organization_id: "org-001",
    storage_zone_id: ZONE_1,
    supplier_id: null,
    type: "WITHDRAWAL",
    status: "DRAFT",
    idempotency_key: null,
    lock_version: 0,
    created_by: "user-001",
    created_at: "",
    posted_at: null,
    posted_by: null,
    voided_at: null,
    voided_by: null,
    updated_at: "",
  };
  const withdrawalLine: StockDocumentLine = {
    id: "wl-001",
    document_id: "doc-w-001",
    product_id: PRODUCT_A,
    input_payload: null,
    delta_quantity_canonical: -10,
    canonical_unit_id: UNIT_IDS.pce,
    canonical_family: "count",
    canonical_label: "Piece",
    context_hash: "abc12345",
    created_at: "",
    updated_at: "",
  };
  const withdrawalSnapshot: ZoneStockSnapshot = {
    id: "zss-w-001",
    establishment_id: "est-001",
    organization_id: "org-001",
    storage_zone_id: ZONE_1,
    snapshot_version_id: SNAPSHOT_1,
    activated_at: "",
    activated_by: null,
    created_at: "",
    updated_at: "",
  };

  it("validates withdrawal document with negative delta lines", () => {
    const result = validatePrePost({
      document: withdrawalDoc,
      lines: [withdrawalLine],
      zoneSnapshot: withdrawalSnapshot,
      expectedLockVersion: 0,
    });
    expect(result.valid).toBe(true);
  });

  it("validates withdrawal with positive delta (correction scenario)", () => {
    const positiveLine: StockDocumentLine = {
      ...withdrawalLine,
      delta_quantity_canonical: 5, // return to stock
    };
    const result = validatePrePost({
      document: withdrawalDoc,
      lines: [positiveLine],
      zoneSnapshot: withdrawalSnapshot,
      expectedLockVersion: 0,
    });
    // validatePrePost doesn't enforce sign — that's a business rule at a higher level
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. NEGATIVE STOCK — Edge: Multiple Lines for Same Product
// ═══════════════════════════════════════════════════════════════════════════

describe("Post Guards — checkNegativeStock — Same Product Multiple Lines", () => {
  it("checks each line independently (same product can appear multiple times)", () => {
    // Two withdrawal lines for the same product
    const lines: StockDocumentLine[] = [
      {
        id: "l1",
        document_id: "d1",
        product_id: PRODUCT_A,
        input_payload: null,
        delta_quantity_canonical: -20,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: null,
        context_hash: "x",
        created_at: "",
        updated_at: "",
      },
      {
        id: "l2",
        document_id: "d1",
        product_id: PRODUCT_A,
        input_payload: null,
        delta_quantity_canonical: -15,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: null,
        context_hash: "x",
        created_at: "",
        updated_at: "",
      },
    ];
    const estimates = new Map([[PRODUCT_A, 25]]);
    const negatives = checkNegativeStock(lines, estimates);
    // Each line is checked independently against the current estimate
    // Line 1: 25 - 20 = 5 (OK)
    // Line 2: 25 - 15 = 10 (OK)
    // Both are checked against the SAME estimate (not cumulative)
    expect(negatives).toHaveLength(0);
  });

  it("detects when a single large withdrawal exceeds stock", () => {
    const lines: StockDocumentLine[] = [
      {
        id: "l1",
        document_id: "d1",
        product_id: PRODUCT_A,
        input_payload: null,
        delta_quantity_canonical: -5,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: null,
        context_hash: "x",
        created_at: "",
        updated_at: "",
      },
      {
        id: "l2",
        document_id: "d1",
        product_id: PRODUCT_A,
        input_payload: null,
        delta_quantity_canonical: -30,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: null,
        context_hash: "x",
        created_at: "",
        updated_at: "",
      },
    ];
    const estimates = new Map([[PRODUCT_A, 10]]);
    const negatives = checkNegativeStock(lines, estimates);
    // Line 1: 10 - 5 = 5 (OK)
    // Line 2: 10 - 30 = -20 (negative)
    expect(negatives).toHaveLength(1);
    expect(negatives[0].resulting_stock).toBe(-20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. IDEMPOTENCY — Key Collision Safety Across Establishments
// ═══════════════════════════════════════════════════════════════════════════

describe("Post Guards — Idempotency Key Cross-Establishment Safety", () => {
  it("same document ID in different establishments produces different keys", () => {
    const k1 = generateIdempotencyKey("doc-shared", "est-alpha", 0);
    const k2 = generateIdempotencyKey("doc-shared", "est-beta", 0);
    expect(k1).not.toBe(k2);
  });

  it("same document+establishment with different versions produces different keys", () => {
    const keys = new Set<string>();
    for (let v = 0; v < 50; v++) {
      keys.add(generateIdempotencyKey("doc-1", "est-1", v));
    }
    // All 50 versions must produce unique keys
    expect(keys.size).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. INTEGRATION: Receipt → Stock Estimate → Void → Recheck
// ═══════════════════════════════════════════════════════════════════════════

describe("Integration — Receipt → Estimate → Void → Recheck", () => {
  const snapshotLine: SnapshotLine = {
    product_id: PRODUCT_A,
    quantity: 100,
    unit_id: UNIT_IDS.pce,
  };

  it("full lifecycle: snapshot → receipt events → estimate → void → re-estimate", () => {
    // Step 1: Estimate from snapshot only (no events)
    const step1 = getEstimatedStock(PRODUCT_A, ZONE_1, SNAPSHOT_1, snapshotLine, [], unitResolver);
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;
    expect(step1.data.estimated_quantity).toBe(100);

    // Step 2: Add receipt events
    const receiptEvents = [
      makeEvent({
        delta_quantity_canonical: 24,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
      makeEvent({
        delta_quantity_canonical: 6,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
    ];
    const step2 = getEstimatedStock(
      PRODUCT_A,
      ZONE_1,
      SNAPSHOT_1,
      snapshotLine,
      receiptEvents,
      unitResolver
    );
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;
    expect(step2.data.estimated_quantity).toBe(130); // 100 + 24 + 6

    // Step 3: Prepare void events for the receipt
    const postedDoc: StockDocument = {
      id: "doc-receipt-001",
      establishment_id: "est-001",
      organization_id: "org-001",
      storage_zone_id: ZONE_1,
      supplier_id: null,
      type: "RECEIPT",
      status: "POSTED",
      idempotency_key: "key-001",
      lock_version: 2,
      created_by: "user-001",
      created_at: "",
      posted_at: "2026-01-01T00:00:00Z",
      posted_by: "user-001",
      voided_at: null,
      voided_by: null,
      updated_at: "",
    };
    const fullEvents: StockEvent[] = [
      {
        id: "evt-r1",
        establishment_id: "est-001",
        organization_id: "org-001",
        storage_zone_id: ZONE_1,
        product_id: PRODUCT_A,
        document_id: "doc-receipt-001",
        event_type: "RECEIPT",
        event_reason: "Reception",
        delta_quantity_canonical: 24,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: "Piece",
        context_hash: "ctx123",
        snapshot_version_id: SNAPSHOT_1,
        override_flag: false,
        override_reason: null,
        posted_at: "2026-01-01T00:00:00Z",
        posted_by: "user-001",
        voids_event_id: null,
        voids_document_id: null,
        created_at: "",
      },
      {
        id: "evt-r2",
        establishment_id: "est-001",
        organization_id: "org-001",
        storage_zone_id: ZONE_1,
        product_id: PRODUCT_A,
        document_id: "doc-receipt-001",
        event_type: "RECEIPT",
        event_reason: "Reception",
        delta_quantity_canonical: 6,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
        canonical_label: "Piece",
        context_hash: "ctx123",
        snapshot_version_id: SNAPSHOT_1,
        override_flag: false,
        override_reason: null,
        posted_at: "2026-01-01T00:00:00Z",
        posted_by: "user-001",
        voids_event_id: null,
        voids_document_id: null,
        created_at: "",
      },
    ];

    const voidResult = prepareVoidEvents(
      postedDoc,
      fullEvents,
      "void-doc-001",
      "user-002",
      "Erreur"
    );
    expect(voidResult.ok).toBe(true);

    // Step 4: Verify void balance
    const balance = verifyVoidBalance(fullEvents, voidResult.voidEvents!);
    expect(balance.balanced).toBe(true);

    // Step 5: Re-estimate with original + void events
    const allEvents = [
      ...receiptEvents,
      ...voidResult.voidEvents!.map((ve) =>
        makeEvent({
          delta_quantity_canonical: ve.delta_quantity_canonical,
          canonical_unit_id: ve.canonical_unit_id,
          canonical_family: ve.canonical_family,
        })
      ),
    ];
    const step5 = getEstimatedStock(
      PRODUCT_A,
      ZONE_1,
      SNAPSHOT_1,
      snapshotLine,
      allEvents,
      unitResolver
    );
    expect(step5.ok).toBe(true);
    if (!step5.ok) return;
    // 100 + 24 + 6 - 24 - 6 = 100 (back to snapshot)
    expect(step5.data.estimated_quantity).toBe(100);
    expect(step5.data.events_count).toBe(4);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// 16. BACKWARD COMPAT — Products without articles still work
// ═══════════════════════════════════════════════════════════════════════════

describe("StockEngine — Backward Compat (products without article)", () => {
  it("getEstimatedStock works unchanged with standard events", () => {
    const events = [
      makeEvent({
        delta_quantity_canonical: 10,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
      makeEvent({
        delta_quantity_canonical: -3,
        canonical_unit_id: UNIT_IDS.pce,
        canonical_family: "count",
      }),
    ];

    const result = getEstimatedStock(
      PRODUCT_A,
      ZONE_1,
      SNAPSHOT_1,
      { product_id: PRODUCT_A, quantity: 50, unit_id: UNIT_IDS.pce },
      events,
      unitResolver
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 50 + 10 - 3 = 57
    expect(result.data.estimated_quantity).toBe(57);
    expect(result.data.events_count).toBe(2);
    expect(result.data.product_id).toBe(PRODUCT_A);
  });

  it("getEstimatedStockBatch works unchanged for products", () => {
    const results = getEstimatedStockBatch(
      ZONE_1,
      SNAPSHOT_1,
      [
        {
          product_id: PRODUCT_A,
          snapshotLine: { product_id: PRODUCT_A, quantity: 20, unit_id: UNIT_IDS.pce },
          events: [
            makeEvent({
              delta_quantity_canonical: 5,
              canonical_unit_id: UNIT_IDS.pce,
              canonical_family: "count",
            }),
          ],
        },
      ],
      unitResolver
    );

    expect(results.size).toBe(1);
    const a = results.get(PRODUCT_A);
    expect(a?.ok).toBe(true);
    if (a?.ok) expect(a.data.estimated_quantity).toBe(25);
  });
});


