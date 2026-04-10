// @vitest-environment jsdom
/**
 * Tests for the new resolveCanonical logic:
 * - Canonical = deepest terminal unit in packaging tree
 * - Normalize: g→kg, ml/cl→L
 * - No special "variable weight" branch
 */
import { describe, it, expect } from "vitest";
import { resolveWizardUnitContext } from "../resolveProductUnitContext";
import type { UnitWithFamily, ConversionRule } from "../types";
import type { PackagingLevel } from "@/modules/conditionnementV2";

// ── Mock units (mimicking measurement_units table) ──
const UNITS: UnitWithFamily[] = [
  { id: "u-kg", name: "Kilogramme", abbreviation: "kg", category: "weight", family: "weight", is_reference: true, aliases: null },
  { id: "u-g", name: "Gramme", abbreviation: "g", category: "weight", family: "weight", is_reference: false, aliases: null },
  { id: "u-l", name: "Litre", abbreviation: "L", category: "volume", family: "volume", is_reference: true, aliases: null },
  { id: "u-ml", name: "Millilitre", abbreviation: "ml", category: "volume", family: "volume", is_reference: false, aliases: null },
  { id: "u-cl", name: "Centilitre", abbreviation: "cl", category: "volume", family: "volume", is_reference: false, aliases: null },
  { id: "u-pce", name: "Pièce", abbreviation: "pce", category: "count", family: "count", is_reference: true, aliases: null },
  { id: "u-pot", name: "Pot", abbreviation: "pot", category: "packaging", family: "packaging", is_reference: false, aliases: null },
  { id: "u-canette", name: "Canette", abbreviation: "canette", category: "packaging", family: "packaging", is_reference: false, aliases: null },
  { id: "u-carton", name: "Carton", abbreviation: "carton", category: "packaging", family: "packaging", is_reference: false, aliases: null },
  { id: "u-lot", name: "Lot", abbreviation: "lot", category: "packaging", family: "packaging", is_reference: false, aliases: null },
  { id: "u-paquet", name: "Paquet", abbreviation: "paquet", category: "packaging", family: "packaging", is_reference: false, aliases: null },
  { id: "u-pack", name: "Pack", abbreviation: "pack", category: "packaging", family: "packaging", is_reference: false, aliases: null },
  { id: "u-sac", name: "Sac", abbreviation: "sac", category: "packaging", family: "packaging", is_reference: false, aliases: null },
  { id: "u-sachet", name: "Sachet", abbreviation: "sachet", category: "packaging", family: "packaging", is_reference: false, aliases: null },
  { id: "u-boite", name: "Boîte", abbreviation: "boîte", category: "packaging", family: "packaging", is_reference: false, aliases: null },
];

const NO_CONVERSIONS: ConversionRule[] = [];

function mkLevel(typeId: string, containsId: string, qty: number = 1): PackagingLevel {
  return {
    id: crypto.randomUUID(),
    type: "",
    type_unit_id: typeId,
    containsQuantity: qty,
    containsUnit: "",
    contains_unit_id: containsId,
  };
}

function getCanonical(
  finalUnitId: string,
  levels: PackagingLevel[],
  billedUnitId: string | null = null
): string | null {
  const ctx = resolveWizardUnitContext(
    { finalUnitId, billedUnitId, packagingLevels: levels, equivalence: null },
    null,
    UNITS,
    NO_CONVERSIONS
  );
  return ctx.canonicalInventoryUnitId;
}

describe("resolveCanonical — single rule from packaging tree", () => {
  it("kg simple → kg", () => {
    expect(getCanonical("u-kg", [])).toBe("u-kg");
  });

  it("L simple → L", () => {
    expect(getCanonical("u-l", [])).toBe("u-l");
  });

  it("Carton → Lot → Paquet → Pot → canonical = Pot", () => {
    const levels = [
      mkLevel("u-carton", "u-lot", 2),
      mkLevel("u-lot", "u-paquet", 3),
      mkLevel("u-paquet", "u-pot", 4),
    ];
    expect(getCanonical("u-carton", levels)).toBe("u-pot");
  });

  it("Carton → Boîte → Pièce → 125g → canonical = kg", () => {
    const levels = [
      mkLevel("u-carton", "u-boite", 6),
      mkLevel("u-boite", "u-pce", 4),
      mkLevel("u-pce", "u-g", 125),
    ];
    expect(getCanonical("u-carton", levels)).toBe("u-kg");
  });

  it("Pack → Canette → canonical = Canette", () => {
    const levels = [mkLevel("u-pack", "u-canette", 6)];
    expect(getCanonical("u-pack", levels)).toBe("u-canette");
  });

  it("Sac → 25kg → canonical = kg", () => {
    const levels = [mkLevel("u-sac", "u-kg", 25)];
    expect(getCanonical("u-sac", levels)).toBe("u-kg");
  });

  it("Sachet → 500g → canonical = kg", () => {
    const levels = [mkLevel("u-sachet", "u-g", 500)];
    expect(getCanonical("u-sachet", levels)).toBe("u-kg");
  });

  it("ml terminal → L", () => {
    const levels = [mkLevel("u-pack", "u-ml", 500)];
    expect(getCanonical("u-pack", levels)).toBe("u-l");
  });

  it("cl terminal → L", () => {
    const levels = [mkLevel("u-pack", "u-cl", 33)];
    expect(getCanonical("u-pack", levels)).toBe("u-l");
  });

  it("no levels, g as finalUnit → kg", () => {
    expect(getCanonical("u-g", [])).toBe("u-kg");
  });

  it("billing unit is ignored — canonical from tree only", () => {
    // billing = kg, but tree says Pot → canonical = Pot
    const levels = [mkLevel("u-carton", "u-pot", 10)];
    expect(getCanonical("u-carton", levels, "u-kg")).toBe("u-pot");
  });
});
