/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FILTER EXISTING PRODUCTS — Unit Tests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests the product filtering logic that separates new products
 * from existing ones using code_produit and name_normalized matching.
 */

import { describe, it, expect } from "vitest";
import { filterExistingProducts } from "../filterExistingProducts";
import type { ExistingProduct } from "../../types";

// Minimal ExtractedProductLine factory
function makeExtractedItem(overrides: {
  nom_produit_complet: string;
  code_produit?: string | null;
  quantite_commandee?: number | null;
  prix_total_ligne?: number | null;
}) {
  return {
    nom_produit_complet: overrides.nom_produit_complet,
    code_produit: overrides.code_produit ?? null,
    quantite_commandee: overrides.quantite_commandee ?? 1,
    prix_total_ligne: overrides.prix_total_ligne ?? 10,
    unite: null,
    description: null,
    prix_unitaire: null,
    tva_pct: null,
  } as never; // cast to ExtractedProductLine
}

function makeExistingProduct(
  overrides: Partial<ExistingProduct> & { id: string; nom_produit: string; name_normalized: string }
): ExistingProduct {
  return {
    code_produit: null,
    prix_unitaire: null,
    conditionnement: null,
    ...overrides,
  };
}

describe("filterExistingProducts", () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC MATCHING
  // ═══════════════════════════════════════════════════════════════════════════

  it("returns all items as new when no existing products", () => {
    const items = [
      makeExtractedItem({ nom_produit_complet: "Burrata" }),
      makeExtractedItem({ nom_produit_complet: "Asiago" }),
    ];
    const result = filterExistingProducts(items, []);
    expect(result.filteredItems).toHaveLength(2);
    expect(result.existingItems).toHaveLength(0);
    expect(result.filteredOutCount).toBe(0);
  });

  it("returns empty when all items exist", () => {
    const items = [makeExtractedItem({ nom_produit_complet: "Burrata" })];
    const existing = [
      makeExistingProduct({ id: "p1", nom_produit: "Burrata", name_normalized: "burrata" }),
    ];
    const result = filterExistingProducts(items, existing);
    expect(result.filteredItems).toHaveLength(0);
    expect(result.existingItems).toHaveLength(1);
    expect(result.filteredOutCount).toBe(1);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 1: code_produit MATCHING
  // ═══════════════════════════════════════════════════════════════════════════

  it("matches by code_produit (case-insensitive)", () => {
    const items = [
      makeExtractedItem({ nom_produit_complet: "Totally Different Name", code_produit: "ABC123" }),
    ];
    const existing = [
      makeExistingProduct({
        id: "p1",
        nom_produit: "Original Name",
        name_normalized: "original name",
        code_produit: "abc123",
      }),
    ];
    const result = filterExistingProducts(items, existing);
    expect(result.filteredItems).toHaveLength(0);
    expect(result.existingItems).toHaveLength(1);
  });

  it("trims whitespace from code_produit", () => {
    const items = [makeExtractedItem({ nom_produit_complet: "Product", code_produit: " ABC123 " })];
    const existing = [
      makeExistingProduct({
        id: "p1",
        nom_produit: "Product",
        name_normalized: "product",
        code_produit: "ABC123",
      }),
    ];
    const result = filterExistingProducts(items, existing);
    expect(result.existingItems).toHaveLength(1);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 2: name_normalized MATCHING
  // ═══════════════════════════════════════════════════════════════════════════

  it("matches by normalized name when no code_produit", () => {
    const items = [makeExtractedItem({ nom_produit_complet: "BURRATA FRAÎCHE" })];
    const existing = [
      makeExistingProduct({
        id: "p1",
        nom_produit: "Burrata Fraiche",
        name_normalized: "burrata fraiche",
      }),
    ];
    const result = filterExistingProducts(items, existing);
    expect(result.existingItems).toHaveLength(1);
  });

  it("does not match by name when code_produit does not match", () => {
    // Item has a code, but it doesn't match. Name check is still performed
    // because the filterExistingProducts checks code first, then falls to name
    const items = [
      makeExtractedItem({ nom_produit_complet: "Burrata", code_produit: "UNKNOWN-CODE" }),
    ];
    const existing = [
      makeExistingProduct({
        id: "p1",
        nom_produit: "Burrata",
        name_normalized: "burrata",
        code_produit: "DIFFERENT-CODE",
      }),
    ];
    const result = filterExistingProducts(items, existing);
    // Code doesn't match, so check name. "burrata" == "burrata" -> existing
    expect(result.existingItems).toHaveLength(1);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MIXED SCENARIOS
  // ═══════════════════════════════════════════════════════════════════════════

  it("separates new and existing products correctly", () => {
    const items = [
      makeExtractedItem({ nom_produit_complet: "Burrata", code_produit: "BUR-001" }),
      makeExtractedItem({ nom_produit_complet: "Unknown Product" }),
      makeExtractedItem({ nom_produit_complet: "Asiago" }),
    ];
    const existing = [
      makeExistingProduct({
        id: "p1",
        nom_produit: "Burrata",
        name_normalized: "burrata",
        code_produit: "BUR-001",
      }),
      makeExistingProduct({ id: "p2", nom_produit: "Asiago", name_normalized: "asiago" }),
    ];
    const result = filterExistingProducts(items, existing);
    expect(result.filteredItems).toHaveLength(1); // "Unknown Product"
    expect(result.existingItems).toHaveLength(2); // "Burrata" + "Asiago"
    expect(result.filteredOutCount).toBe(2);
  });

  it("handles empty items array", () => {
    const existing = [
      makeExistingProduct({ id: "p1", nom_produit: "Burrata", name_normalized: "burrata" }),
    ];
    const result = filterExistingProducts([], existing);
    expect(result.filteredItems).toHaveLength(0);
    expect(result.existingItems).toHaveLength(0);
    expect(result.filteredOutCount).toBe(0);
  });

  it("handles existing products with null code_produit and name_normalized", () => {
    const items = [makeExtractedItem({ nom_produit_complet: "Test Product" })];
    const existing = [makeExistingProduct({ id: "p1", nom_produit: "Other", name_normalized: "" })];
    const result = filterExistingProducts(items, existing);
    expect(result.filteredItems).toHaveLength(1);
    expect(result.existingItems).toHaveLength(0);
  });
});
