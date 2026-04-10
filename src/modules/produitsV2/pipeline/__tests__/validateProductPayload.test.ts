// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  checkRequiredFields,
  checkUnitExists,
  validateGraph,
  checkCollision,
  validateProductPayload,
  type ProductValidationInput,
  type CollisionChecker,
} from "../validateProductPayload";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const UNIT_PIECE: UnitWithFamily = { id: "uid-pce", name: "Pièce", abbreviation: "pce", category: "unit", family: null, is_reference: false, aliases: null };
const UNIT_CARTON: UnitWithFamily = { id: "uid-carton", name: "Carton", abbreviation: "crt", category: "packaging", family: null, is_reference: false, aliases: null };
const UNIT_KG: UnitWithFamily = { id: "uid-kg", name: "Kilogramme", abbreviation: "kg", category: "mass", family: "mass", is_reference: true, aliases: null };

const DB_UNITS: UnitWithFamily[] = [UNIT_PIECE, UNIT_CARTON, UNIT_KG];
const DB_CONVERSIONS: ConversionRule[] = [];

const noCollision: CollisionChecker = async () => ({ hasCollision: false, collisionType: null, existingProductName: null });
const withCollision: CollisionChecker = async () => ({ hasCollision: true, collisionType: "name", existingProductName: "Tomate cerise (existant)" });

function makeValidInput(overrides?: Partial<ProductValidationInput>): ProductValidationInput {
  return {
    productName: "Tomate cerise",
    supplierId: "sup-1",
    storageZoneId: "zone-1",
    finalUnitId: "uid-pce",
    finalUnit: "Pièce",
    stockHandlingUnitId: "uid-pce",
    billedUnitId: "uid-pce",
    deliveryUnitId: null,
    priceDisplayUnitId: null,
    kitchenUnitId: null,
    packagingLevels: [],
    equivalence: null,
    establishmentId: "est-1",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. checkRequiredFields
// ─────────────────────────────────────────────────────────────────────────────

describe("checkRequiredFields", () => {
  it("Cas 1 — payload valide → valid: true", () => {
    expect(checkRequiredFields(makeValidInput())).toEqual({ valid: true });
  });

  it("Cas 2 — productName vide → MISSING_FIELD", () => {
    const result = checkRequiredFields(makeValidInput({ productName: "  " }));
    expect(result).toEqual(expect.objectContaining({ valid: false, code: "MISSING_FIELD", field: "productName" }));
  });

  it("Cas 3 — storageZoneId null → MISSING_FIELD", () => {
    const result = checkRequiredFields(makeValidInput({ storageZoneId: null }));
    expect(result).toEqual(expect.objectContaining({ valid: false, code: "MISSING_FIELD", field: "storageZoneId" }));
  });

  it("Cas 4 — stockHandlingUnitId null → MISSING_FIELD", () => {
    const result = checkRequiredFields(makeValidInput({ stockHandlingUnitId: null }));
    expect(result).toEqual(expect.objectContaining({ valid: false, code: "MISSING_FIELD", field: "stockHandlingUnitId" }));
  });

  it("supplierId null → MISSING_FIELD", () => {
    const result = checkRequiredFields(makeValidInput({ supplierId: null }));
    expect(result).toEqual(expect.objectContaining({ valid: false, code: "MISSING_FIELD", field: "supplierId" }));
  });

  it("finalUnitId null → MISSING_FIELD", () => {
    const result = checkRequiredFields(makeValidInput({ finalUnitId: null }));
    expect(result).toEqual(expect.objectContaining({ valid: false, code: "MISSING_FIELD", field: "finalUnitId" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. checkUnitExists
// ─────────────────────────────────────────────────────────────────────────────

describe("checkUnitExists", () => {
  it("Cas 1 — all units exist → valid: true", () => {
    expect(checkUnitExists(makeValidInput(), DB_UNITS)).toEqual({ valid: true });
  });

  it("Cas 5 — unknown finalUnitId → UNIT_NOT_FOUND", () => {
    const result = checkUnitExists(makeValidInput({ finalUnitId: "uid-unknown" }), DB_UNITS);
    expect(result).toEqual(expect.objectContaining({ valid: false, code: "UNIT_NOT_FOUND", unitId: "uid-unknown" }));
  });

  it("unknown packaging type_unit_id → UNIT_NOT_FOUND", () => {
    const input = makeValidInput({
      packagingLevels: [
        { id: "lvl-1", type: "Caisse", type_unit_id: "uid-ghost", containsQuantity: 10, containsUnit: "Pièce", contains_unit_id: "uid-pce" },
      ],
    });
    const result = checkUnitExists(input, DB_UNITS);
    expect(result).toEqual(expect.objectContaining({ valid: false, code: "UNIT_NOT_FOUND", unitId: "uid-ghost" }));
  });

  it("null optional units are skipped", () => {
    expect(checkUnitExists(makeValidInput({ deliveryUnitId: null, priceDisplayUnitId: null }), DB_UNITS)).toEqual({ valid: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. validateGraph
// ─────────────────────────────────────────────────────────────────────────────

describe("validateGraph", () => {
  it("Cas 1 — simple product (pce, no packaging) → valid", () => {
    expect(validateGraph(makeValidInput(), DB_UNITS, DB_CONVERSIONS).valid).toBe(true);
  });

  it("Cas 7 — unreachable billing unit → GRAPH_INVALID", () => {
    const result = validateGraph(makeValidInput({ billedUnitId: "uid-kg" }), DB_UNITS, DB_CONVERSIONS);
    expect(result).toEqual(expect.objectContaining({ valid: false, code: "GRAPH_INVALID" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. checkCollision
// ─────────────────────────────────────────────────────────────────────────────

describe("checkCollision", () => {
  it("no collision → valid: true", async () => {
    expect(await checkCollision(makeValidInput(), noCollision)).toEqual({ valid: true });
  });

  it("Cas 6 — collision → COLLISION", async () => {
    const result = await checkCollision(makeValidInput(), withCollision);
    expect(result).toEqual(expect.objectContaining({ valid: false, code: "COLLISION" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. validateProductPayload (fail-fast)
// ─────────────────────────────────────────────────────────────────────────────

describe("validateProductPayload", () => {
  it("Cas 1 — valid payload → valid: true", async () => {
    const result = await validateProductPayload(makeValidInput(), DB_UNITS, DB_CONVERSIONS, noCollision);
    expect(result).toEqual({ valid: true });
  });

  it("Cas 8 — MISSING_FIELD stops before checkUnitExists", async () => {
    const input = makeValidInput({ productName: "", finalUnitId: "uid-unknown" });
    const result = await validateProductPayload(input, DB_UNITS, DB_CONVERSIONS, noCollision);
    expect(result).toEqual(expect.objectContaining({ valid: false, code: "MISSING_FIELD" }));
  });
});
