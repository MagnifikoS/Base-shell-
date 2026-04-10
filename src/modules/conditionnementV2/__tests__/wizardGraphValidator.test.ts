import { describe, it, expect } from "vitest";
import {
  validatePackagingLevel,
  detectPackagingCycles,
  validateAllPackaging,
  validateUnitReachability,
  validateFullGraph,
  filterReachableUnits,
} from "../wizardGraphValidator";
import type { PackagingLevel, Equivalence } from "../types";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";

// ─── Test fixtures ──────────────────────────────────────────────────────────

const u = (id: string, name: string, abbr: string, family: string | null): UnitWithFamily => ({
  id, name, abbreviation: abbr, family, category: "test", is_reference: false, aliases: null,
});

const UNITS: UnitWithFamily[] = [
  u("uuid-pce", "Pièce", "pce", "unit"),
  u("uuid-kg", "Kilogramme", "kg", "weight"),
  u("uuid-g", "Gramme", "g", "weight"),
  u("uuid-carton", "Carton", "crt", "packaging"),
  u("uuid-boite", "Boîte", "bte", "packaging"),
  u("uuid-L", "Litre", "L", "volume"),
];

const DB_CONVERSIONS: ConversionRule[] = [
  { id: "r1", from_unit_id: "uuid-kg", to_unit_id: "uuid-g", factor: 1000, is_active: true, establishment_id: null },
];

// ─── validatePackagingLevel ─────────────────────────────────────────────────

describe("validatePackagingLevel", () => {
  it("detects self-reference", () => {
    const level: PackagingLevel = {
      id: "l1", type: "Carton", type_unit_id: "uuid-carton",
      containsQuantity: 10, containsUnit: "Carton", contains_unit_id: "uuid-carton",
    };
    const errors = validatePackagingLevel(level, 0, [level], "uuid-pce");
    expect(errors.some((e) => e.code === "SELF_REF")).toBe(true);
  });

  it("detects missing quantity", () => {
    const level: PackagingLevel = {
      id: "l1", type: "Carton", type_unit_id: "uuid-carton",
      containsQuantity: null, containsUnit: "Pièce", contains_unit_id: "uuid-pce",
    };
    const errors = validatePackagingLevel(level, 0, [level], "uuid-pce");
    expect(errors.some((e) => e.code === "MISSING_QTY")).toBe(true);
  });

  it("rejects fractional quantity for discrete units (e.g. Pièce)", () => {
    const level: PackagingLevel = {
      id: "l1", type: "Carton", type_unit_id: "uuid-carton",
      containsQuantity: 2.5, containsUnit: "Pièce", contains_unit_id: "uuid-pce",
    };
    const errors = validatePackagingLevel(level, 0, [level], "uuid-pce", UNITS);
    expect(errors.some((e) => e.code === "INVALID_QTY")).toBe(true);
  });

  it("allows fractional quantity for weight units (e.g. kg)", () => {
    const level: PackagingLevel = {
      id: "l1", type: "Sac", type_unit_id: "uuid-carton",
      containsQuantity: 2.5, containsUnit: "Kilogramme", contains_unit_id: "uuid-kg",
    };
    const errors = validatePackagingLevel(level, 0, [level], "uuid-kg", UNITS);
    expect(errors.some((e) => e.code === "INVALID_QTY")).toBe(false);
  });

  it("allows fractional quantity for volume units (e.g. L)", () => {
    const level: PackagingLevel = {
      id: "l1", type: "Bouteille", type_unit_id: "uuid-carton",
      containsQuantity: 0.75, containsUnit: "Litre", contains_unit_id: "uuid-L",
    };
    const errors = validatePackagingLevel(level, 0, [level], "uuid-L", UNITS);
    expect(errors.some((e) => e.code === "INVALID_QTY")).toBe(false);
  });

  it("rejects zero quantity", () => {
    const level: PackagingLevel = {
      id: "l1", type: "Carton", type_unit_id: "uuid-carton",
      containsQuantity: 0, containsUnit: "Pièce", contains_unit_id: "uuid-pce",
    };
    const errors = validatePackagingLevel(level, 0, [level], "uuid-pce");
    expect(errors.some((e) => e.code === "INVALID_QTY")).toBe(true);
  });

  it("detects duplicate type", () => {
    const levels: PackagingLevel[] = [
      { id: "l1", type: "Carton", type_unit_id: "uuid-carton", containsQuantity: 10, containsUnit: "Pièce", contains_unit_id: "uuid-pce" },
      { id: "l2", type: "Carton", type_unit_id: "uuid-carton", containsQuantity: 5, containsUnit: "Boîte", contains_unit_id: "uuid-boite" },
    ];
    const errors = validatePackagingLevel(levels[0], 0, levels, "uuid-pce");
    expect(errors.some((e) => e.code === "DUPLICATE_TYPE")).toBe(true);
  });

  it("passes valid level", () => {
    const level: PackagingLevel = {
      id: "l1", type: "Carton", type_unit_id: "uuid-carton",
      containsQuantity: 10, containsUnit: "Pièce", contains_unit_id: "uuid-pce",
    };
    const errors = validatePackagingLevel(level, 0, [level], "uuid-pce");
    expect(errors).toHaveLength(0);
  });
});

// ─── detectPackagingCycles ──────────────────────────────────────────────────

describe("detectPackagingCycles", () => {
  it("detects A→B→A cycle", () => {
    const levels: PackagingLevel[] = [
      { id: "l1", type: "Carton", type_unit_id: "uuid-carton", containsQuantity: 10, containsUnit: "Boîte", contains_unit_id: "uuid-boite" },
      { id: "l2", type: "Boîte", type_unit_id: "uuid-boite", containsQuantity: 5, containsUnit: "Carton", contains_unit_id: "uuid-carton" },
    ];
    const errors = detectPackagingCycles(levels);
    expect(errors.some((e) => e.code === "CYCLE")).toBe(true);
  });

  it("no cycle for linear chain", () => {
    const levels: PackagingLevel[] = [
      { id: "l1", type: "Carton", type_unit_id: "uuid-carton", containsQuantity: 10, containsUnit: "Boîte", contains_unit_id: "uuid-boite" },
      { id: "l2", type: "Boîte", type_unit_id: "uuid-boite", containsQuantity: 5, containsUnit: "Pièce", contains_unit_id: "uuid-pce" },
    ];
    const errors = detectPackagingCycles(levels);
    expect(errors).toHaveLength(0);
  });
});

// ─── validateFullGraph ──────────────────────────────────────────────────────

describe("validateFullGraph", () => {
  it("rejects missing reference unit", () => {
    const result = validateFullGraph({
      finalUnitId: null, finalUnit: null,
      packagingLevels: [], equivalence: null,
      billedUnitId: null, deliveryUnitId: null,
      stockHandlingUnitId: null, kitchenUnitId: null, priceDisplayUnitId: null,
      dbUnits: UNITS, dbConversions: DB_CONVERSIONS,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("NO_REF_UNIT");
  });

  it("passes simple product (pce, no packaging)", () => {
    const result = validateFullGraph({
      finalUnitId: "uuid-pce", finalUnit: "Pièce",
      packagingLevels: [], equivalence: null,
      billedUnitId: "uuid-pce", deliveryUnitId: "uuid-pce",
      stockHandlingUnitId: "uuid-pce", kitchenUnitId: null, priceDisplayUnitId: "uuid-pce",
      dbUnits: UNITS, dbConversions: DB_CONVERSIONS,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects billing unit with no path to reference", () => {
    const result = validateFullGraph({
      finalUnitId: "uuid-pce", finalUnit: "Pièce",
      packagingLevels: [], equivalence: null,
      billedUnitId: "uuid-L", deliveryUnitId: "uuid-pce",
      stockHandlingUnitId: "uuid-pce", kitchenUnitId: null, priceDisplayUnitId: "uuid-pce",
      dbUnits: UNITS, dbConversions: DB_CONVERSIONS,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "NO_PATH")).toBe(true);
  });

  it("passes with valid packaging chain", () => {
    const levels: PackagingLevel[] = [
      { id: "l1", type: "Carton", type_unit_id: "uuid-carton", containsQuantity: 10, containsUnit: "Pièce", contains_unit_id: "uuid-pce" },
    ];
    const result = validateFullGraph({
      finalUnitId: "uuid-pce", finalUnit: "Pièce",
      packagingLevels: levels, equivalence: null,
      billedUnitId: "uuid-carton", deliveryUnitId: "uuid-carton",
      stockHandlingUnitId: "uuid-pce", kitchenUnitId: null, priceDisplayUnitId: "uuid-pce",
      dbUnits: UNITS, dbConversions: DB_CONVERSIONS,
    });
    expect(result.valid).toBe(true);
  });
});

// ─── filterReachableUnits ───────────────────────────────────────────────────

describe("filterReachableUnits", () => {
  it("filters out unreachable units", () => {
    const candidates = ["uuid-pce", "uuid-kg", "uuid-L"];
    const result = filterReachableUnits(
      candidates, "uuid-pce", [], null, UNITS, DB_CONVERSIONS
    );
    // Only pce reaches pce directly (no equivalence), kg and L don't
    expect(result).toContain("uuid-pce");
    expect(result).not.toContain("uuid-L");
  });

  it("includes packaging units with valid chain", () => {
    const levels: PackagingLevel[] = [
      { id: "l1", type: "Carton", type_unit_id: "uuid-carton", containsQuantity: 10, containsUnit: "Pièce", contains_unit_id: "uuid-pce" },
    ];
    const candidates = ["uuid-pce", "uuid-carton", "uuid-L"];
    const result = filterReachableUnits(
      candidates, "uuid-pce", levels, null, UNITS, DB_CONVERSIONS
    );
    expect(result).toContain("uuid-carton");
    expect(result).not.toContain("uuid-L");
  });
});
