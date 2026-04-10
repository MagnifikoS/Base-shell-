// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildInputConfigPayload, type InputConfigPayloadInput } from "../buildInputConfigPayload";
import type { PackagingLevel } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const DB_UNITS = [
  { id: "uid-pce", family: null },
  { id: "uid-kg", family: "weight" },
  { id: "uid-carton", family: null },
  { id: "uid-boite", family: null },
];

const packagingCartonBoite: PackagingLevel[] = [
  { id: "lvl-1", type: "Carton", type_unit_id: "uid-carton", containsQuantity: 12, containsUnit: "Boîte", contains_unit_id: "uid-boite" },
  { id: "lvl-2", type: "Boîte", type_unit_id: "uid-boite", containsQuantity: 6, containsUnit: "Pièce", contains_unit_id: "uid-pce" },
];

function makeInput(overrides?: Partial<InputConfigPayloadInput>): InputConfigPayloadInput {
  return {
    finalUnitId: "uid-pce",
    billedUnitId: "uid-carton",
    stockHandlingUnitId: "uid-pce",
    packagingLevels: [],
    allowUnitSale: false,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("buildInputConfigPayload", () => {
  it("Cas A — produit simple sans packaging, allowUnitSale=false", () => {
    const result = buildInputConfigPayload(makeInput(), DB_UNITS);

    // purchase: no packaging → final unit, integer (discrete)
    expect(result.purchase_mode).toBe("integer");
    expect(result.purchase_preferred_unit_id).toBe("uid-pce");
    expect(result.purchase_unit_chain).toBeNull();

    // reception: no packaging, toggle OFF → integer on final unit
    expect(result.reception_mode).toBe("integer");
    expect(result.reception_preferred_unit_id).toBe("uid-pce");
    expect(result.reception_unit_chain).toBeNull();

    // internal: no packaging, toggle OFF → integer on stock unit
    expect(result.internal_mode).toBe("integer");
    expect(result.internal_preferred_unit_id).toBe("uid-pce");
    expect(result.internal_unit_chain).toBeNull();
  });

  it("Cas B — packaging 2 niveaux, allowUnitSale=true → multi_level", () => {
    const result = buildInputConfigPayload(
      makeInput({
        packagingLevels: packagingCartonBoite,
        allowUnitSale: true,
      }),
      DB_UNITS,
    );

    // purchase: has packaging → L0, integer
    expect(result.purchase_mode).toBe("integer");
    expect(result.purchase_preferred_unit_id).toBe("uid-carton");

    // reception: toggle ON + ≥2 levels → multi_level
    expect(result.reception_mode).toBe("multi_level");
    expect(result.reception_preferred_unit_id).toBeNull();
    expect(result.reception_unit_chain).toEqual(["uid-carton", "uid-boite"]);

    // internal: toggle ON + ≥2 levels → multi_level, full chain
    expect(result.internal_mode).toBe("multi_level");
    expect(result.internal_preferred_unit_id).toBeNull();
    expect(result.internal_unit_chain).toEqual(["uid-carton", "uid-boite"]);
  });

  it("Cas C — billedUnitId null → fallback sur finalUnitId", () => {
    const result = buildInputConfigPayload(
      makeInput({ billedUnitId: null, finalUnitId: "uid-pce" }),
      DB_UNITS,
    );

    // The fallback ensures billedUnitId resolves to finalUnitId internally.
    // Purchase still auto-computes from physical structure (no packaging → finalUnit)
    expect(result.purchase_preferred_unit_id).toBe("uid-pce");
  });

  it("Cas D — receptionModeOverride explicit → passthrough", () => {
    const result = buildInputConfigPayload(
      makeInput({
        receptionModeOverride: "continuous",
        receptionUnitIdOverride: "uid-kg",
      }),
      DB_UNITS,
    );

    expect(result.reception_mode).toBe("continuous");
    expect(result.reception_preferred_unit_id).toBe("uid-kg");
    expect(result.reception_unit_chain).toBeNull();

    // internal still auto-computed
    expect(result.internal_mode).toBe("integer");
  });

  it("continuous final unit → continuous mode for purchase/reception", () => {
    const result = buildInputConfigPayload(
      makeInput({ finalUnitId: "uid-kg", stockHandlingUnitId: "uid-kg" }),
      DB_UNITS,
    );

    expect(result.purchase_mode).toBe("continuous");
    expect(result.reception_mode).toBe("continuous");
    expect(result.internal_mode).toBe("continuous");
  });

  it("packaging + toggle OFF → integer L0 for purchase and reception", () => {
    const result = buildInputConfigPayload(
      makeInput({
        packagingLevels: packagingCartonBoite,
        allowUnitSale: false,
      }),
      DB_UNITS,
    );

    expect(result.purchase_mode).toBe("integer");
    expect(result.purchase_preferred_unit_id).toBe("uid-carton");
    expect(result.reception_mode).toBe("integer");
    expect(result.reception_preferred_unit_id).toBe("uid-carton");
    // internal: toggle OFF → integer on stock handling unit
    expect(result.internal_mode).toBe("integer");
    expect(result.internal_preferred_unit_id).toBe("uid-pce");
  });
});
