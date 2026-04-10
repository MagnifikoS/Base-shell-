/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST GUARDS + STOCK HELPERS — Extended Tests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ACTION-ITEMS.md reference: STK-LED-026 (P3 Testing)
 *
 * Tests the pure engine functions used by stock ledger hooks:
 * - postGuards: validatePrePost, generateIdempotencyKey, checkNegativeStock
 * - contextHash: computeContextHash, buildContextHashInput
 * - buildCanonicalLine: extractPackagingLevels, extractEquivalence, buildCanonicalLine
 * - errorDiagnostics: getErrorDiagnosticLabel, getErrorActionHint, getErrorCodeLabel
 * - types: getInputPayloadProductName
 *
 * Focus on PURE FUNCTIONS that don't require React rendering context.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from "vitest";
import { validatePrePost, generateIdempotencyKey, checkNegativeStock } from "../postGuards";
import { computeContextHash, buildContextHashInput } from "../contextHash";
import {
  buildCanonicalLine,
  extractPackagingLevels,
  extractEquivalence,
} from "../buildCanonicalLine";
import {
  getErrorDiagnosticLabel,
  getErrorActionHint,
  getErrorCodeLabel,
} from "../errorDiagnostics";
import { getInputPayloadProductName } from "../../types";
import type {
  StockDocument,
  StockDocumentLine,
  ZoneStockSnapshot,
  ContextHashInput,
  StockEngineError,
} from "../../types";
import type { UnitInfo, ProductConfig } from "../buildCanonicalLine";

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
};

const PRODUCT_A = "product-a";
const ZONE_1 = "zone-1";
const SNAPSHOT_1 = "snapshot-1";

function makeDoc(overrides?: Partial<StockDocument>): StockDocument {
  return {
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
    ...overrides,
  };
}

function makeLine(overrides?: Partial<StockDocumentLine>): StockDocumentLine {
  return {
    id: "line-001",
    document_id: "doc-001",
    product_id: PRODUCT_A,
    input_payload: null,
    delta_quantity_canonical: 10,
    canonical_unit_id: UNIT_IDS.pce,
    canonical_family: "count",
    canonical_label: "Piece",
    context_hash: "abc12345",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function makeSnapshot(overrides?: Partial<ZoneStockSnapshot>): ZoneStockSnapshot {
  return {
    id: "zss-001",
    establishment_id: "est-001",
    organization_id: "org-001",
    storage_zone_id: ZONE_1,
    snapshot_version_id: SNAPSHOT_1,
    activated_at: "",
    activated_by: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. IDEMPOTENCY KEY — Extended Tests (STK-LED-030)
// ═══════════════════════════════════════════════════════════════════════════

describe("generateIdempotencyKey — Extended", () => {
  it("is deterministic: same inputs always produce same key", () => {
    const key1 = generateIdempotencyKey("doc-A", "est-1", 5);
    const key2 = generateIdempotencyKey("doc-A", "est-1", 5);
    const key3 = generateIdempotencyKey("doc-A", "est-1", 5);
    expect(key1).toBe(key2);
    expect(key2).toBe(key3);
  });

  it("does NOT contain Date.now() or timestamp (STK-LED-030 fix)", () => {
    const key = generateIdempotencyKey("doc-1", "est-1", 0);
    // Key should be deterministic format, no timestamp
    expect(key).toBe("post_est-1_doc-1_v0");
    // Running again should give identical result
    expect(generateIdempotencyKey("doc-1", "est-1", 0)).toBe(key);
  });

  it("different establishment IDs produce different keys", () => {
    const k1 = generateIdempotencyKey("doc-1", "est-A", 0);
    const k2 = generateIdempotencyKey("doc-1", "est-B", 0);
    expect(k1).not.toBe(k2);
  });

  it("lock_version 0 is the default when omitted", () => {
    const explicit = generateIdempotencyKey("doc-1", "est-1", 0);
    const defaulted = generateIdempotencyKey("doc-1", "est-1");
    expect(explicit).toBe(defaulted);
  });

  it("includes all three components in the key", () => {
    const key = generateIdempotencyKey("my-doc", "my-est", 7);
    expect(key).toContain("my-doc");
    expect(key).toContain("my-est");
    expect(key).toContain("7");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. VALIDATE PRE-POST — Extended Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe("validatePrePost — Extended", () => {
  it("fails when line has empty canonical_unit_id", () => {
    // Empty string is falsy in JS — !("") === true — so the guard catches it
    const line = makeLine({ canonical_unit_id: "" });
    const result = validatePrePost({
      document: makeDoc(),
      lines: [line],
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("unité canonique");
  });

  it("fails when line has empty canonical_family", () => {
    const line = makeLine({ canonical_family: "" });
    const result = validatePrePost({
      document: makeDoc(),
      lines: [line],
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("famille canonique");
  });

  it("fails when line has empty context_hash", () => {
    const line = makeLine({ context_hash: "" });
    const result = validatePrePost({
      document: makeDoc(),
      lines: [line],
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("context_hash");
  });

  it("detects multiple invalid lines and reports errors for each", () => {
    const lines = [
      makeLine({
        id: "line-1",
        product_id: "p1",
        canonical_unit_id: undefined as unknown as string,
      }),
      makeLine({
        id: "line-2",
        product_id: "p2",
        canonical_family: undefined as unknown as string,
      }),
    ];
    const result = validatePrePost({
      document: makeDoc(),
      lines,
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("succeeds with multiple valid lines", () => {
    const lines = [
      makeLine({ id: "line-1", product_id: "p1" }),
      makeLine({ id: "line-2", product_id: "p2" }),
      makeLine({ id: "line-3", product_id: "p3" }),
    ];
    const result = validatePrePost({
      document: makeDoc(),
      lines,
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("lock_version 0 matches expected 0", () => {
    const result = validatePrePost({
      document: makeDoc({ lock_version: 0 }),
      lines: [makeLine()],
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 0,
    });
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. CHECK NEGATIVE STOCK — Extended (deprecated under Stock Zéro V2, kept for compat)
// ═══════════════════════════════════════════════════════════════════════════

describe("checkNegativeStock — Extended (deprecated, backend clamps)", () => {
  it("handles product not in estimates map (defaults to 0)", () => {
    const lines: StockDocumentLine[] = [
      makeLine({ product_id: "unknown-product", delta_quantity_canonical: -5 }),
    ];
    const estimates = new Map<string, number>();
    const negatives = checkNegativeStock(lines, estimates);
    expect(negatives).toHaveLength(1);
    expect(negatives[0].current_estimated).toBe(0);
    expect(negatives[0].resulting_stock).toBe(-5);
  });

  it("handles exact zero resulting stock (not negative)", () => {
    const lines: StockDocumentLine[] = [
      makeLine({ product_id: PRODUCT_A, delta_quantity_canonical: -10 }),
    ];
    const estimates = new Map([[PRODUCT_A, 10]]);
    const negatives = checkNegativeStock(lines, estimates);
    expect(negatives).toHaveLength(0);
  });

  it("handles multiple products, mixed positive and negative results", () => {
    const lines: StockDocumentLine[] = [
      makeLine({ id: "l1", product_id: "prod-A", delta_quantity_canonical: -50 }),
      makeLine({ id: "l2", product_id: "prod-B", delta_quantity_canonical: -10 }),
      makeLine({ id: "l3", product_id: "prod-C", delta_quantity_canonical: -5 }),
    ];
    const estimates = new Map([
      ["prod-A", 30], // 30 - 50 = -20 (negative)
      ["prod-B", 100], // 100 - 10 = 90 (positive)
      ["prod-C", 5], // 5 - 5 = 0 (zero, not negative)
    ]);
    const negatives = checkNegativeStock(lines, estimates);
    expect(negatives).toHaveLength(1);
    expect(negatives[0].product_id).toBe("prod-A");
    expect(negatives[0].resulting_stock).toBe(-20);
  });

  it("handles fractional quantities with 4-decimal precision", () => {
    const lines: StockDocumentLine[] = [
      makeLine({ product_id: PRODUCT_A, delta_quantity_canonical: -0.0001 }),
    ];
    const estimates = new Map([[PRODUCT_A, 0.0001]]);
    const negatives = checkNegativeStock(lines, estimates);
    // 0.0001 - 0.0001 = 0 (exactly zero, not negative)
    expect(negatives).toHaveLength(0);
  });

  it("positive deltas never cause negative stock", () => {
    const lines: StockDocumentLine[] = [
      makeLine({ product_id: PRODUCT_A, delta_quantity_canonical: 100 }),
    ];
    const estimates = new Map([[PRODUCT_A, -10]]);
    const negatives = checkNegativeStock(lines, estimates);
    // -10 + 100 = 90 (positive)
    expect(negatives).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CONTEXT HASH — Extended
// ═══════════════════════════════════════════════════════════════════════════

describe("computeContextHash — Extended", () => {
  it("handles empty packaging levels", () => {
    const input: ContextHashInput = {
      canonical_unit_id: UNIT_IDS.pce,
      billing_unit_id: null,
      packaging_levels: [],
      equivalence: null,
    };
    const hash = computeContextHash(input);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("handles null billing_unit_id", () => {
    const withBilling: ContextHashInput = {
      canonical_unit_id: UNIT_IDS.pce,
      billing_unit_id: UNIT_IDS.kg,
      packaging_levels: [],
      equivalence: null,
    };
    const withoutBilling: ContextHashInput = {
      canonical_unit_id: UNIT_IDS.pce,
      billing_unit_id: null,
      packaging_levels: [],
      equivalence: null,
    };
    expect(computeContextHash(withBilling)).not.toBe(computeContextHash(withoutBilling));
  });

  it("handles null fields in equivalence", () => {
    const input: ContextHashInput = {
      canonical_unit_id: UNIT_IDS.pce,
      billing_unit_id: null,
      packaging_levels: [],
      equivalence: { source_unit_id: null, unit_id: null, quantity: null },
    };
    const hash = computeContextHash(input);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("handles null fields in packaging levels", () => {
    const input: ContextHashInput = {
      canonical_unit_id: UNIT_IDS.pce,
      billing_unit_id: null,
      packaging_levels: [{ type_unit_id: null, contains_unit_id: null, quantity: 1 }],
      equivalence: null,
    };
    const hash = computeContextHash(input);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("different packaging level quantities produce different hashes", () => {
    const a: ContextHashInput = {
      canonical_unit_id: UNIT_IDS.pce,
      billing_unit_id: null,
      packaging_levels: [
        { type_unit_id: UNIT_IDS.carton, contains_unit_id: UNIT_IDS.pce, quantity: 6 },
      ],
      equivalence: null,
    };
    const b: ContextHashInput = {
      ...a,
      packaging_levels: [
        { type_unit_id: UNIT_IDS.carton, contains_unit_id: UNIT_IDS.pce, quantity: 12 },
      ],
    };
    expect(computeContextHash(a)).not.toBe(computeContextHash(b));
  });
});

describe("buildContextHashInput", () => {
  it("builds valid input from product config", () => {
    const result = buildContextHashInput({
      canonical_unit_id: UNIT_IDS.pce,
      billing_unit_id: UNIT_IDS.kg,
      packaging_levels: [
        { type_unit_id: UNIT_IDS.carton, contains_unit_id: UNIT_IDS.pce, quantity: 24 },
      ],
      equivalence: { source_unit_id: UNIT_IDS.pce, unit_id: UNIT_IDS.g, quantity: 50 },
    });
    expect(result.canonical_unit_id).toBe(UNIT_IDS.pce);
    expect(result.billing_unit_id).toBe(UNIT_IDS.kg);
    expect(result.packaging_levels).toHaveLength(1);
    expect(result.equivalence).not.toBeNull();
  });

  it("handles null equivalence", () => {
    const result = buildContextHashInput({
      canonical_unit_id: UNIT_IDS.pce,
      billing_unit_id: null,
      packaging_levels: [],
      equivalence: null,
    });
    expect(result.equivalence).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. BUILD CANONICAL LINE — Helpers
// ═══════════════════════════════════════════════════════════════════════════

describe("extractPackagingLevels", () => {
  it("returns empty array for null config", () => {
    expect(extractPackagingLevels(null)).toEqual([]);
  });

  it("returns empty array for non-object config", () => {
    expect(extractPackagingLevels("string" as unknown as null)).toEqual([]);
  });

  it("returns empty array for array config", () => {
    expect(extractPackagingLevels([] as unknown as null)).toEqual([]);
  });

  it("returns empty array when no levels key", () => {
    expect(extractPackagingLevels({ other: "data" })).toEqual([]);
  });

  it("returns empty array when levels is not an array", () => {
    expect(extractPackagingLevels({ levels: "not-array" })).toEqual([]);
  });

  it("extracts valid packaging levels", () => {
    const config = {
      levels: [
        { type_unit_id: "carton", contains_unit_id: "pce", quantity: 24 },
        { type_unit_id: "pce", contains_unit_id: "g", quantity: 50 },
      ],
    };
    const result = extractPackagingLevels(config);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type_unit_id: "carton",
      contains_unit_id: "pce",
      quantity: 24,
    });
  });

  it("handles levels with missing fields (defaults to null/1)", () => {
    const config = {
      levels: [
        { quantity: 6 }, // missing type_unit_id and contains_unit_id
      ],
    };
    const result = extractPackagingLevels(config);
    expect(result).toHaveLength(1);
    expect(result[0].type_unit_id).toBeNull();
    expect(result[0].contains_unit_id).toBeNull();
    expect(result[0].quantity).toBe(6);
  });

  it("handles non-string type_unit_id (defaults to null)", () => {
    const config = {
      levels: [{ type_unit_id: 123, contains_unit_id: "pce", quantity: 1 }],
    };
    const result = extractPackagingLevels(config);
    expect(result[0].type_unit_id).toBeNull();
  });

  it("handles non-number quantity (defaults to 1)", () => {
    const config = {
      levels: [{ type_unit_id: "x", contains_unit_id: "y", quantity: "bad" }],
    };
    const result = extractPackagingLevels(config);
    expect(result[0].quantity).toBe(1);
  });
});

describe("extractEquivalence", () => {
  it("returns null for null config", () => {
    expect(extractEquivalence(null)).toBeNull();
  });

  it("returns null for non-object config", () => {
    expect(extractEquivalence(42 as unknown as null)).toBeNull();
  });

  it("returns null when no equivalence key", () => {
    expect(extractEquivalence({ levels: [] })).toBeNull();
  });

  it("returns null when equivalence is not an object", () => {
    expect(extractEquivalence({ equivalence: "string" })).toBeNull();
  });

  it("returns null when equivalence is an array", () => {
    expect(extractEquivalence({ equivalence: [1, 2, 3] })).toBeNull();
  });

  it("extracts valid equivalence", () => {
    const config = {
      equivalence: {
        source_unit_id: "pce",
        unit_id: "g",
        quantity: 50,
      },
    };
    const result = extractEquivalence(config);
    expect(result).toEqual({
      source_unit_id: "pce",
      unit_id: "g",
      quantity: 50,
    });
  });

  it("handles missing fields (defaults to null)", () => {
    const config = { equivalence: {} };
    const result = extractEquivalence(config);
    expect(result).toEqual({
      source_unit_id: null,
      unit_id: null,
      quantity: null,
    });
  });
});

describe("buildCanonicalLine", () => {
  const units: UnitInfo[] = [
    { id: UNIT_IDS.pce, family: "count", abbreviation: "pce", name: "Piece" },
    { id: UNIT_IDS.kg, family: "weight", abbreviation: "kg", name: "Kilogramme" },
    { id: "unit-no-family", family: null, abbreviation: "?", name: "Unknown" },
  ];

  it("builds canonical line metadata for valid unit", () => {
    const product: ProductConfig = {
      supplier_billing_unit_id: null,
      conditionnement_config: null,
    };
    const result = buildCanonicalLine({
      canonicalUnitId: UNIT_IDS.pce,
      product,
      units,
    });
    expect(result.canonical_unit_id).toBe(UNIT_IDS.pce);
    expect(result.canonical_family).toBe("count");
    expect(result.canonical_label).toBe("pce");
    expect(result.context_hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("throws for unknown unit ID", () => {
    const product: ProductConfig = {
      supplier_billing_unit_id: null,
      conditionnement_config: null,
    };
    expect(() =>
      buildCanonicalLine({
        canonicalUnitId: "nonexistent-unit",
        product,
        units,
      })
    ).toThrow("UNIT_NOT_FOUND");
  });

  it("throws for unit without family", () => {
    const product: ProductConfig = {
      supplier_billing_unit_id: null,
      conditionnement_config: null,
    };
    expect(() =>
      buildCanonicalLine({
        canonicalUnitId: "unit-no-family",
        product,
        units,
      })
    ).toThrow("UNIT_NO_FAMILY");
  });

  it("incorporates packaging levels into context hash", () => {
    const productWithoutPkg: ProductConfig = {
      supplier_billing_unit_id: null,
      conditionnement_config: null,
    };
    const productWithPkg: ProductConfig = {
      supplier_billing_unit_id: null,
      conditionnement_config: {
        levels: [{ type_unit_id: UNIT_IDS.carton, contains_unit_id: UNIT_IDS.pce, quantity: 24 }],
      },
    };
    const r1 = buildCanonicalLine({
      canonicalUnitId: UNIT_IDS.pce,
      product: productWithoutPkg,
      units,
    });
    const r2 = buildCanonicalLine({
      canonicalUnitId: UNIT_IDS.pce,
      product: productWithPkg,
      units,
    });
    expect(r1.context_hash).not.toBe(r2.context_hash);
  });

  it("same product config produces same context hash (deterministic)", () => {
    const product: ProductConfig = {
      supplier_billing_unit_id: UNIT_IDS.kg,
      conditionnement_config: {
        levels: [{ type_unit_id: UNIT_IDS.carton, contains_unit_id: UNIT_IDS.pce, quantity: 24 }],
        equivalence: { source_unit_id: UNIT_IDS.pce, unit_id: "unit-g-003", quantity: 50 },
      },
    };
    const r1 = buildCanonicalLine({ canonicalUnitId: UNIT_IDS.pce, product, units });
    const r2 = buildCanonicalLine({ canonicalUnitId: UNIT_IDS.pce, product, units });
    expect(r1.context_hash).toBe(r2.context_hash);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. ERROR DIAGNOSTICS — All Codes
// ═══════════════════════════════════════════════════════════════════════════

describe("Error Diagnostics", () => {
  const codes: StockEngineError["code"][] = [
    "NO_ACTIVE_SNAPSHOT",
    "NO_SNAPSHOT_LINE",
    "FAMILY_MISMATCH",
    "INCOMPATIBLE_FAMILY_CHANGE",
    "MISSING_UNIT_INFO",
  ];

  describe("getErrorDiagnosticLabel", () => {
    it.each(codes)("returns non-empty label for %s", (code) => {
      const label = getErrorDiagnosticLabel(code);
      expect(label).toBeTruthy();
      expect(label.length).toBeGreaterThan(0);
    });

    it("returns fallback for unknown code", () => {
      const label = getErrorDiagnosticLabel("UNKNOWN_CODE" as StockEngineError["code"]);
      expect(label).toContain("inconnue");
    });
  });

  describe("getErrorActionHint", () => {
    it.each(codes)("returns non-empty hint for %s", (code) => {
      const hint = getErrorActionHint(code);
      expect(hint).toBeTruthy();
      expect(hint.length).toBeGreaterThan(0);
    });

    it("returns fallback for unknown code", () => {
      const hint = getErrorActionHint("UNKNOWN_CODE" as StockEngineError["code"]);
      expect(hint).toContain("support");
    });
  });

  describe("getErrorCodeLabel", () => {
    it.each(codes)("returns short code for %s", (code) => {
      const label = getErrorCodeLabel(code);
      expect(label).toBeTruthy();
      expect(label.length).toBeLessThanOrEqual(12);
    });

    it("returns ERR for unknown code", () => {
      expect(getErrorCodeLabel("UNKNOWN_CODE" as StockEngineError["code"])).toBe("ERR");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. TYPE HELPERS — getInputPayloadProductName
// ═══════════════════════════════════════════════════════════════════════════

describe("getInputPayloadProductName", () => {
  it("extracts product_name from valid payload", () => {
    expect(getInputPayloadProductName({ product_name: "Burrata" })).toBe("Burrata");
  });

  it("returns undefined for null payload", () => {
    expect(getInputPayloadProductName(null)).toBeUndefined();
  });

  it("returns undefined for non-object payload", () => {
    expect(getInputPayloadProductName("string" as unknown as null)).toBeUndefined();
  });

  it("returns undefined when product_name is not a string", () => {
    expect(getInputPayloadProductName({ product_name: 42 })).toBeUndefined();
  });

  it("returns undefined when product_name key is missing", () => {
    expect(getInputPayloadProductName({ other_key: "value" })).toBeUndefined();
  });

  it("handles empty string product_name", () => {
    expect(getInputPayloadProductName({ product_name: "" })).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. VALIDATE PRE-POST — Maximum Error Accumulation
// ═══════════════════════════════════════════════════════════════════════════

describe("validatePrePost — All Guards Failing Simultaneously", () => {
  it("accumulates 4+ errors when everything is invalid", () => {
    // POSTED doc + no snapshot + wrong lock version + no lines
    const result = validatePrePost({
      document: makeDoc({ status: "POSTED", lock_version: 99 }),
      lines: [],
      zoneSnapshot: null,
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    // Should have at least: status error, snapshot error, lock_version error, no lines error
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  it("accumulates line-level errors alongside document-level errors", () => {
    const badLines = [
      makeLine({
        id: "l1",
        product_id: "p1",
        canonical_unit_id: "",
        canonical_family: "",
        context_hash: "",
      }),
      makeLine({ id: "l2", product_id: "p2", canonical_unit_id: "", canonical_family: "" }),
    ];
    const result = validatePrePost({
      document: makeDoc({ status: "VOID", lock_version: 5 }),
      lines: badLines,
      zoneSnapshot: null,
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    // Document errors: status, snapshot, lock_version
    // Line errors: l1 has 3 missing fields, l2 has 2 missing fields
    expect(result.errors.length).toBeGreaterThanOrEqual(7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. IDEMPOTENCY KEY — Format Stability Guarantees
// ═══════════════════════════════════════════════════════════════════════════

describe("generateIdempotencyKey — Format Stability", () => {
  it("format matches documented pattern: post_{est}_{doc}_v{version}", () => {
    const key = generateIdempotencyKey("doc-abc-123", "est-xyz-456", 42);
    expect(key).toBe("post_est-xyz-456_doc-abc-123_v42");
  });

  it("handles UUID-style IDs correctly", () => {
    const key = generateIdempotencyKey(
      "550e8400-e29b-41d4-a716-446655440000",
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      3
    );
    expect(key).toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(key).toContain("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(key).toContain("v3");
  });

  it("large lock versions are handled", () => {
    const key = generateIdempotencyKey("doc-1", "est-1", 999999);
    expect(key).toContain("v999999");
  });

  it("different document IDs always produce different keys (collision safety)", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      keys.add(generateIdempotencyKey(`doc-${i}`, "est-1", 0));
    }
    expect(keys.size).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. CHECK NEGATIVE STOCK — Floating Point Precision Stress
// ═══════════════════════════════════════════════════════════════════════════

describe("checkNegativeStock — Precision Stress Tests", () => {
  it("handles 0.1 + 0.2 - 0.3 = 0 scenario (no false negative)", () => {
    // Classic JS floating point: 0.1 + 0.2 = 0.30000000000000004
    // If current = 0.3 and delta = -0.3, result should be 0, not negative
    const lines: StockDocumentLine[] = [
      makeLine({ product_id: "fp-test", delta_quantity_canonical: -0.3 }),
    ];
    const estimates = new Map([["fp-test", 0.3]]);
    const negatives = checkNegativeStock(lines, estimates);
    expect(negatives).toHaveLength(0);
  });

  it("handles tiny epsilon below zero (0.0001 precision boundary)", () => {
    const lines: StockDocumentLine[] = [
      makeLine({ product_id: "eps-test", delta_quantity_canonical: -10.0001 }),
    ];
    const estimates = new Map([["eps-test", 10]]);
    const negatives = checkNegativeStock(lines, estimates);
    // 10 - 10.0001 = -0.0001 (genuinely negative at 4-decimal precision)
    expect(negatives).toHaveLength(1);
    expect(negatives[0].resulting_stock).toBe(-0.0001);
  });

  it("handles many products at once (10 products)", () => {
    const lines: StockDocumentLine[] = [];
    const estimates = new Map<string, number>();

    for (let i = 0; i < 10; i++) {
      const productId = `prod-batch-${i}`;
      // Even products go negative, odd products stay positive
      const delta = i % 2 === 0 ? -(i + 20) : -(i + 1);
      lines.push(
        makeLine({ id: `l-${i}`, product_id: productId, delta_quantity_canonical: delta })
      );
      estimates.set(productId, 10); // All start at 10
    }

    const negatives = checkNegativeStock(lines, estimates);
    // Products 0, 2, 4, 6, 8 go negative (delta = -20, -22, -24, -26, -28)
    // Products 1, 3, 5, 7, 9 stay positive (delta = -2, -4, -6, -8, -10)
    expect(negatives).toHaveLength(5);
    for (const neg of negatives) {
      expect(neg.resulting_stock).toBeLessThan(0);
    }
  });

  it("positive current stock exactly covering negative delta = zero (not negative)", () => {
    const lines: StockDocumentLine[] = [
      makeLine({ product_id: "exact-zero", delta_quantity_canonical: -99.9999 }),
    ];
    const estimates = new Map([["exact-zero", 99.9999]]);
    const negatives = checkNegativeStock(lines, estimates);
    expect(negatives).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. VALIDATE PRE-POST — VOID Status Rejection
// ═══════════════════════════════════════════════════════════════════════════

describe("validatePrePost — Document Status Variants", () => {
  it("rejects VOID status", () => {
    const result = validatePrePost({
      document: makeDoc({ status: "VOID" }),
      lines: [makeLine()],
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("VOID");
  });

  it("rejects POSTED status", () => {
    const result = validatePrePost({
      document: makeDoc({ status: "POSTED" }),
      lines: [makeLine()],
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("POSTED");
  });

  it("accepts DRAFT status", () => {
    const result = validatePrePost({
      document: makeDoc({ status: "DRAFT" }),
      lines: [makeLine()],
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. CONTEXT HASH — Ordering Independence Proof
// ═══════════════════════════════════════════════════════════════════════════

describe("computeContextHash — Ordering Independence", () => {
  it("same packaging levels in different order produce identical hash", () => {
    const inputA: ContextHashInput = {
      canonical_unit_id: UNIT_IDS.pce,
      billing_unit_id: null,
      packaging_levels: [
        { type_unit_id: UNIT_IDS.carton, contains_unit_id: UNIT_IDS.pce, quantity: 24 },
        { type_unit_id: UNIT_IDS.boite, contains_unit_id: UNIT_IDS.pce, quantity: 6 },
      ],
      equivalence: null,
    };
    const inputB: ContextHashInput = {
      ...inputA,
      packaging_levels: [
        { type_unit_id: UNIT_IDS.boite, contains_unit_id: UNIT_IDS.pce, quantity: 6 },
        { type_unit_id: UNIT_IDS.carton, contains_unit_id: UNIT_IDS.pce, quantity: 24 },
      ],
    };
    expect(computeContextHash(inputA)).toBe(computeContextHash(inputB));
  });

  it("three packaging levels in any permutation produce same hash", () => {
    const levels = [
      { type_unit_id: "a", contains_unit_id: "b", quantity: 1 },
      { type_unit_id: "c", contains_unit_id: "d", quantity: 2 },
      { type_unit_id: "e", contains_unit_id: "f", quantity: 3 },
    ];
    const base: ContextHashInput = {
      canonical_unit_id: UNIT_IDS.pce,
      billing_unit_id: null,
      packaging_levels: levels,
      equivalence: null,
    };
    const permutations = [
      [levels[0], levels[1], levels[2]],
      [levels[0], levels[2], levels[1]],
      [levels[1], levels[0], levels[2]],
      [levels[1], levels[2], levels[0]],
      [levels[2], levels[0], levels[1]],
      [levels[2], levels[1], levels[0]],
    ];
    const baseHash = computeContextHash(base);
    for (const perm of permutations) {
      expect(computeContextHash({ ...base, packaging_levels: perm })).toBe(baseHash);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. VALIDATE PRE-POST — Line-Level Field Combinations
// ═══════════════════════════════════════════════════════════════════════════

describe("validatePrePost — Line Field Validation Combinations", () => {
  it("fails when line has null canonical_unit_id", () => {
    const line = makeLine({ canonical_unit_id: null as unknown as string });
    const result = validatePrePost({
      document: makeDoc(),
      lines: [line],
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("unité canonique"))).toBe(true);
  });

  it("fails when line has null canonical_family", () => {
    const line = makeLine({ canonical_family: null as unknown as string });
    const result = validatePrePost({
      document: makeDoc(),
      lines: [line],
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("famille canonique"))).toBe(true);
  });

  it("fails when line has null context_hash", () => {
    const line = makeLine({ context_hash: null as unknown as string });
    const result = validatePrePost({
      document: makeDoc(),
      lines: [line],
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("context_hash"))).toBe(true);
  });

  it("reports errors for all three missing fields on one line", () => {
    const line = makeLine({
      canonical_unit_id: "",
      canonical_family: "",
      context_hash: "",
    });
    const result = validatePrePost({
      document: makeDoc(),
      lines: [line],
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    // Should have exactly 3 line-level errors
    expect(result.errors).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. VALIDATE PRE-POST — ADJUSTMENT Document Type
// ═══════════════════════════════════════════════════════════════════════════

describe("validatePrePost — Adjustment Documents", () => {
  it("validates DRAFT ADJUSTMENT document normally", () => {
    const result = validatePrePost({
      document: makeDoc({ type: "ADJUSTMENT", status: "DRAFT" }),
      lines: [makeLine()],
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects POSTED ADJUSTMENT document", () => {
    const result = validatePrePost({
      document: makeDoc({ type: "ADJUSTMENT", status: "POSTED" }),
      lines: [makeLine()],
      zoneSnapshot: makeSnapshot(),
      expectedLockVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("POSTED");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. BUILD CANONICAL LINE — Billing Unit Integration
// ═══════════════════════════════════════════════════════════════════════════

describe("buildCanonicalLine — Billing Unit Context Hash", () => {
  const units: UnitInfo[] = [
    { id: UNIT_IDS.pce, family: "count", abbreviation: "pce", name: "Piece" },
    { id: UNIT_IDS.kg, family: "weight", abbreviation: "kg", name: "Kilogramme" },
  ];

  it("different billing units produce different context hashes", () => {
    const productA: ProductConfig = {
      supplier_billing_unit_id: UNIT_IDS.kg,
      conditionnement_config: null,
    };
    const productB: ProductConfig = {
      supplier_billing_unit_id: UNIT_IDS.pce,
      conditionnement_config: null,
    };
    const rA = buildCanonicalLine({ canonicalUnitId: UNIT_IDS.pce, product: productA, units });
    const rB = buildCanonicalLine({ canonicalUnitId: UNIT_IDS.pce, product: productB, units });
    expect(rA.context_hash).not.toBe(rB.context_hash);
  });

  it("null vs present billing unit produces different context hashes", () => {
    const productNull: ProductConfig = {
      supplier_billing_unit_id: null,
      conditionnement_config: null,
    };
    const productWithBilling: ProductConfig = {
      supplier_billing_unit_id: UNIT_IDS.kg,
      conditionnement_config: null,
    };
    const rNull = buildCanonicalLine({
      canonicalUnitId: UNIT_IDS.pce,
      product: productNull,
      units,
    });
    const rWith = buildCanonicalLine({
      canonicalUnitId: UNIT_IDS.pce,
      product: productWithBilling,
      units,
    });
    expect(rNull.context_hash).not.toBe(rWith.context_hash);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. CHECK NEGATIVE STOCK — Zero Current Stock
// ═══════════════════════════════════════════════════════════════════════════

describe("checkNegativeStock — Zero Starting Stock", () => {
  it("any negative delta on zero stock is detected", () => {
    const lines: StockDocumentLine[] = [
      makeLine({ product_id: PRODUCT_A, delta_quantity_canonical: -0.001 }),
    ];
    const estimates = new Map([[PRODUCT_A, 0]]);
    const negatives = checkNegativeStock(lines, estimates);
    expect(negatives).toHaveLength(1);
    expect(negatives[0].current_estimated).toBe(0);
  });

  it("positive delta on zero stock is fine", () => {
    const lines: StockDocumentLine[] = [
      makeLine({ product_id: PRODUCT_A, delta_quantity_canonical: 100 }),
    ];
    const estimates = new Map([[PRODUCT_A, 0]]);
    const negatives = checkNegativeStock(lines, estimates);
    expect(negatives).toHaveLength(0);
  });

  it("zero delta on zero stock is fine", () => {
    const lines: StockDocumentLine[] = [
      makeLine({ product_id: PRODUCT_A, delta_quantity_canonical: 0 }),
    ];
    const estimates = new Map([[PRODUCT_A, 0]]);
    const negatives = checkNegativeStock(lines, estimates);
    expect(negatives).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. EXTRACT PACKAGING LEVELS — Deep Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe("extractPackagingLevels — Deep Edge Cases", () => {
  it("handles levels array with nested null items", () => {
    const config = {
      levels: [null, undefined, { type_unit_id: "a", contains_unit_id: "b", quantity: 3 }],
    };
    const result = extractPackagingLevels(config);
    // null and undefined items should produce safe defaults
    expect(result).toHaveLength(3);
    expect(result[2].type_unit_id).toBe("a");
  });

  it("handles levels with extra unexpected fields (resilient parsing)", () => {
    const config = {
      levels: [{ type_unit_id: "x", contains_unit_id: "y", quantity: 5, extra_field: "ignored" }],
    };
    const result = extractPackagingLevels(config);
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(5);
  });

  it("handles empty levels array", () => {
    const config = { levels: [] };
    const result = extractPackagingLevels(config);
    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. EXTRACT EQUIVALENCE — Deep Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe("extractEquivalence — Deep Edge Cases", () => {
  it("handles equivalence with extra unexpected fields", () => {
    const config = {
      equivalence: {
        source_unit_id: "a",
        unit_id: "b",
        quantity: 10,
        extra: "ignored",
      },
    };
    const result = extractEquivalence(config);
    expect(result).toEqual({
      source_unit_id: "a",
      unit_id: "b",
      quantity: 10,
    });
  });

  it("handles equivalence with non-string source_unit_id", () => {
    const config = {
      equivalence: {
        source_unit_id: 123,
        unit_id: "b",
        quantity: 10,
      },
    };
    const result = extractEquivalence(config);
    expect(result?.source_unit_id).toBeNull();
    expect(result?.unit_id).toBe("b");
    expect(result?.quantity).toBe(10);
  });

  it("handles equivalence with non-number quantity", () => {
    const config = {
      equivalence: {
        source_unit_id: "a",
        unit_id: "b",
        quantity: "ten",
      },
    };
    const result = extractEquivalence(config);
    expect(result?.quantity).toBeNull();
  });
});
