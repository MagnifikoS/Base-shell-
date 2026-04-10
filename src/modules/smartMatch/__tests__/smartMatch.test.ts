/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SMART_MATCH — Unit Tests (Engine)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from "vitest";
import { normalizeLabel, buildNormalizedKey, textSimilarity } from "../engine/normalize";
import { scoreProducts } from "../engine/scorer";
import type { SmartMatchProductRow, SmartMatchRequest } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// TEST DATA
// ═══════════════════════════════════════════════════════════════════════════

const SUPPLIER_ID = "sup-001";
const ESTABLISHMENT_ID = "est-001";

function makeProduct(overrides: Partial<SmartMatchProductRow> = {}): SmartMatchProductRow {
  return {
    id: overrides.id ?? "prod-1",
    nom_produit: overrides.nom_produit ?? "Carotte Extra",
    name_normalized: overrides.name_normalized ?? "carotte extra",
    code_produit: overrides.code_produit ?? null,
    code_barres: overrides.code_barres ?? null,
    category: overrides.category ?? "Légumes",
    supplier_billing_unit_id: overrides.supplier_billing_unit_id ?? null,
    conditionnement_resume: overrides.conditionnement_resume ?? null,
  };
}

function makeRequest(overrides: Partial<SmartMatchRequest> = {}): SmartMatchRequest {
  return {
    establishment_id: ESTABLISHMENT_ID,
    supplier_id: SUPPLIER_ID,
    raw_label: overrides.raw_label ?? "Carotte Extra",
    code_produit: overrides.code_produit ?? null,
    code_barres: overrides.code_barres ?? null,
    unit_of_sale: overrides.unit_of_sale ?? null,
    packaging: overrides.packaging ?? null,
    category_suggestion: overrides.category_suggestion ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// NORMALIZE
// ═══════════════════════════════════════════════════════════════════════════

describe("normalizeLabel", () => {
  it("lowercases and removes accents", () => {
    expect(normalizeLabel("Café Crème")).toBe("cafe creme");
  });

  it("collapses whitespace", () => {
    expect(normalizeLabel("  hello   world  ")).toBe("hello world");
  });

  it("handles empty/null", () => {
    expect(normalizeLabel("")).toBe("");
    expect(normalizeLabel(null as unknown as string)).toBe("");
  });
});

describe("buildNormalizedKey", () => {
  it("builds underscore-separated key", () => {
    expect(buildNormalizedKey("Café Crème Bio")).toBe("cafe_creme_bio");
  });

  it("strips non-alphanumeric", () => {
    expect(buildNormalizedKey("TOMATE (5kg) @promo")).toBe("tomate_5kg_promo");
  });
});

describe("textSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(textSimilarity("hello", "hello")).toBe(1);
  });

  it("returns 1 for case/accent differences", () => {
    expect(textSimilarity("Café", "cafe")).toBe(1);
  });

  it("returns high similarity for close strings", () => {
    const sim = textSimilarity("Carotte Extra", "Carotte Extra Bio");
    expect(sim).toBeGreaterThan(0.7);
  });

  it("returns low similarity for unrelated strings", () => {
    const sim = textSimilarity("Carotte", "Chocolat");
    expect(sim).toBeLessThan(0.4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCORER
// ═══════════════════════════════════════════════════════════════════════════

describe("scoreProducts", () => {
  it("matches by code_produit exact → confidence 1", () => {
    const product = makeProduct({ code_produit: "ABC123" });
    const result = scoreProducts({
      request: makeRequest({ code_produit: "ABC123", raw_label: "Whatever" }),
      products: [product],
      aliases: [],
    });

    expect(result.bestMatch?.confidence).toBe(1);
    expect(result.bestMatch?.reasons).toContain("code_produit");
    expect(result.autoSelectRecommended).toBe(true);
  });

  it("matches by code_barres → confidence 1", () => {
    const product = makeProduct({ code_barres: "3700000000001" });
    const result = scoreProducts({
      request: makeRequest({ code_barres: "3700000000001", raw_label: "Unknown" }),
      products: [product],
      aliases: [],
    });

    expect(result.bestMatch?.confidence).toBe(1);
    expect(result.bestMatch?.reasons).toContain("code_barres");
  });

  it("code_produit present but not found → fallback to fuzzy, never confidence 1", () => {
    const product = makeProduct({ nom_produit: "Carotte Extra", name_normalized: "carotte extra" });
    const result = scoreProducts({
      request: makeRequest({ code_produit: "UNKNOWN", raw_label: "Carotte Extra" }),
      products: [product],
      aliases: [],
    });

    // Should find via name but capped at 0.85 (not 1.0)
    expect(result.bestMatch).not.toBeNull();
    expect(result.bestMatch!.confidence).toBeLessThan(1);
    expect(result.autoSelectRecommended).toBe(false);
  });

  it("alias exact → confidence 1", () => {
    const product = makeProduct({ id: "prod-1" });
    const result = scoreProducts({
      request: makeRequest({ raw_label: "Carotte Extra" }),
      products: [product],
      aliases: [{ global_product_id: "prod-1", normalized_key: "carotte_extra", supplier_product_code: null }],
    });

    expect(result.bestMatch?.confidence).toBe(1);
    expect(result.bestMatch?.reasons).toContain("alias");
  });

  it("name_normalized exact → confidence 1", () => {
    const product = makeProduct({ name_normalized: "carotte extra" });
    const result = scoreProducts({
      request: makeRequest({ raw_label: "Carotte Extra" }),
      products: [product],
      aliases: [],
    });

    expect(result.bestMatch?.confidence).toBe(1);
    expect(result.bestMatch?.reasons).toContain("name_exact");
  });

  it("fuzzy + brain boost beats fuzzy alone", () => {
    const p1 = makeProduct({ id: "p1", nom_produit: "Carotte Rapée", name_normalized: "carotte rapee" });
    const p2 = makeProduct({ id: "p2", nom_produit: "Carotte Ronde", name_normalized: "carotte ronde" });

    const resultNoBrain = scoreProducts({
      request: makeRequest({ raw_label: "Carotte Rapee" }),
      products: [p1, p2],
      aliases: [],
    });

    const resultWithBrain = scoreProducts({
      request: makeRequest({ raw_label: "Carotte Rapee" }),
      products: [p1, p2],
      aliases: [],
      brainBoosts: { p1: 0.5 },
    });

    const p1ScoreNoBrain = resultNoBrain.candidates.find((c) => c.product_id === "p1")?.confidence ?? 0;
    const p1ScoreWithBrain = resultWithBrain.candidates.find((c) => c.product_id === "p1")?.confidence ?? 0;
    expect(p1ScoreWithBrain).toBeGreaterThan(p1ScoreNoBrain);
  });

  it("supplier_id filter is strict (no cross-supplier)", () => {
    // Products are pre-filtered by supplier_id in API layer
    // Engine only sees products for the correct supplier
    const products = [makeProduct({ id: "p1" })];
    const result = scoreProducts({
      request: makeRequest({ raw_label: "Carotte Extra" }),
      products,
      aliases: [],
    });

    // Should only find products passed in (supplier filtering is API responsibility)
    expect(result.candidates.every((c) => c.product_id === "p1")).toBe(true);
  });

  it("category mismatch does not block", () => {
    const product = makeProduct({ category: "Fruits" });
    const result = scoreProducts({
      request: makeRequest({ raw_label: "Carotte Extra", category_suggestion: "Légumes" }),
      products: [product],
      aliases: [],
    });

    // Should still find the product (category mismatch = no boost, but not blocked)
    expect(result.bestMatch).not.toBeNull();
  });

  it("returns empty when no products match", () => {
    const result = scoreProducts({
      request: makeRequest({ raw_label: "XYZZYX Unknown Product" }),
      products: [makeProduct({ nom_produit: "Banane Cavendish", name_normalized: "banane cavendish" })],
      aliases: [],
    });

    expect(result.candidates.length).toBe(0);
    expect(result.bestMatch).toBeNull();
  });
});
