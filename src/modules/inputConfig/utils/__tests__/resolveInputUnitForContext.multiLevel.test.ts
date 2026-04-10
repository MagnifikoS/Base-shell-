/**
 * Tests for multi_level mode in resolveInputUnitForContext
 */
import { describe, it, expect, vi } from "vitest";
import { resolveInputUnitForContext } from "../resolveInputUnitForContext";
import type { ProductInputConfigRow } from "../../types";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";

// Mock the BFS engine
vi.mock("@/core/unitConversion/resolveProductUnitContext", () => ({
  resolveProductUnitContext: vi.fn(() => ({
    canonicalInventoryUnitId: "unit-kg",
    allowedInventoryEntryUnits: [
      { id: "unit-kg", name: "kg", abbreviation: "kg", factorToTarget: 1, kind: "target", family: "weight" },
      { id: "unit-carton", name: "Carton", abbreviation: "crt", factorToTarget: 12, kind: "packaging", family: "count" },
      { id: "unit-boite", name: "Boîte", abbreviation: "bte", factorToTarget: 2, kind: "packaging", family: "count" },
      { id: "unit-piece", name: "Pièce", abbreviation: "pce", factorToTarget: 1, kind: "reference", family: "count" },
    ],
  })),
}));

const baseProduct = {
  id: "prod-1",
  nom_produit: "Tomates",
  final_unit_id: "unit-kg",
  stock_handling_unit_id: "unit-kg",
  conditionnement_config: null,
};

const dbUnits: UnitWithFamily[] = [
  { id: "unit-kg", name: "kg", abbreviation: "kg", family: "weight", category: "weight", is_reference: true, aliases: [] },
  { id: "unit-carton", name: "Carton", abbreviation: "crt", family: "count", category: "count", is_reference: false, aliases: [] },
  { id: "unit-boite", name: "Boîte", abbreviation: "bte", family: "count", category: "count", is_reference: false, aliases: [] },
  { id: "unit-piece", name: "Pièce", abbreviation: "pce", family: "count", category: "count", is_reference: false, aliases: [] },
];

const dbConversions: ConversionRule[] = [];

function makeConfig(overrides: Partial<ProductInputConfigRow> = {}): ProductInputConfigRow {
  return {
    id: "cfg-1",
    product_id: "prod-1",
    establishment_id: "est-1",
    reception_mode: "integer",
    reception_preferred_unit_id: "unit-carton",
    reception_unit_chain: null,
    internal_mode: "integer",
    internal_preferred_unit_id: "unit-piece",
    internal_unit_chain: null,
    purchase_mode: "integer",
    purchase_preferred_unit_id: "unit-carton",
    purchase_unit_chain: null,
    created_at: "",
    updated_at: "",
    updated_by: null,
    ...overrides,
  };
}

describe("resolveInputUnitForContext — multi_level", () => {
  it("returns unitChain for valid multi_level config", () => {
    const config = makeConfig({
      reception_mode: "multi_level",
      reception_unit_chain: ["unit-carton", "unit-boite"],
    });

    const result = resolveInputUnitForContext(baseProduct, "b2b_sale", config, dbUnits, dbConversions);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.mode).toBe("multi_level");
    if (result.mode !== "multi_level") return;
    expect(result.unitChain).toEqual(["unit-carton", "unit-boite"]);
    expect(result.unitNames).toEqual(["Carton", "Boîte"]);
  });

  it("returns unitChain for 3-level config", () => {
    const config = makeConfig({
      reception_mode: "multi_level",
      reception_unit_chain: ["unit-carton", "unit-boite", "unit-piece"],
    });

    const result = resolveInputUnitForContext(baseProduct, "b2b_sale", config, dbUnits, dbConversions);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.mode).toBe("multi_level");
    if (result.mode !== "multi_level") return;
    expect(result.unitChain).toHaveLength(3);
  });

  it("blocks when unit_chain is null", () => {
    const config = makeConfig({
      reception_mode: "multi_level",
      reception_unit_chain: null,
    });

    const result = resolveInputUnitForContext(baseProduct, "b2b_sale", config, dbUnits, dbConversions);

    expect(result.status).toBe("needs_review");
  });

  it("blocks when unit_chain has < 2 entries", () => {
    const config = makeConfig({
      reception_mode: "multi_level",
      reception_unit_chain: ["unit-carton"],
    });

    const result = resolveInputUnitForContext(baseProduct, "b2b_sale", config, dbUnits, dbConversions);

    expect(result.status).toBe("needs_review");
  });

  it("blocks when unit_chain has duplicates", () => {
    const config = makeConfig({
      reception_mode: "multi_level",
      reception_unit_chain: ["unit-carton", "unit-carton"],
    });

    const result = resolveInputUnitForContext(baseProduct, "b2b_sale", config, dbUnits, dbConversions);

    expect(result.status).toBe("needs_review");
  });

  it("blocks when a unit in chain is not reachable", () => {
    const config = makeConfig({
      reception_mode: "multi_level",
      reception_unit_chain: ["unit-carton", "unit-unknown"],
    });

    const result = resolveInputUnitForContext(baseProduct, "b2b_sale", config, dbUnits, dbConversions);

    expect(result.status).toBe("needs_review");
  });

  it("does not affect single mode resolution", () => {
    const config = makeConfig({
      reception_mode: "integer",
      reception_preferred_unit_id: "unit-carton",
    });

    const result = resolveInputUnitForContext(baseProduct, "b2b_sale", config, dbUnits, dbConversions);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.mode).not.toBe("multi_level");
    if (result.mode === "multi_level") return;
    expect(result.unitId).toBe("unit-carton");
  });

  it("works for internal context too", () => {
    const config = makeConfig({
      internal_mode: "multi_level",
      internal_unit_chain: ["unit-boite", "unit-piece"],
    });

    const result = resolveInputUnitForContext(baseProduct, "internal", config, dbUnits, dbConversions);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.mode).toBe("multi_level");
    if (result.mode !== "multi_level") return;
    expect(result.unitChain).toEqual(["unit-boite", "unit-piece"]);
  });

  it("preserves chain order (no sorting)", () => {
    const config = makeConfig({
      reception_mode: "multi_level",
      reception_unit_chain: ["unit-piece", "unit-carton"],
    });

    const result = resolveInputUnitForContext(baseProduct, "b2b_sale", config, dbUnits, dbConversions);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    if (result.mode !== "multi_level") return;
    // Order must be preserved exactly as stored
    expect(result.unitChain).toEqual(["unit-piece", "unit-carton"]);
  });
});
