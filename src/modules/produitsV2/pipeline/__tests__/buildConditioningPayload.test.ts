// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildConditioningConfig,
  buildConditioningResume,
} from "../buildConditioningPayload";
import type { PackagingLevel, PriceLevel, Equivalence } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const FINAL_UNIT_ID = "uid-piece";
const BILLED_UNIT_ID = "uid-carton";
const EQUIV_SOURCE_ID = "uid-piece";
const EQUIV_UNIT_ID = "uid-g";

const packagingCartonBoite: PackagingLevel[] = [
  {
    id: "lvl-1",
    type: "Carton",
    type_unit_id: "uid-carton",
    containsQuantity: 12,
    containsUnit: "Boîte",
    contains_unit_id: "uid-boite",
  },
  {
    id: "lvl-2",
    type: "Boîte",
    type_unit_id: "uid-boite",
    containsQuantity: 6,
    containsUnit: "Pièce",
    contains_unit_id: FINAL_UNIT_ID,
  },
];

const priceLevelFinal: PriceLevel = {
  type: "final",
  label: "Pièce",
};

const priceLevelLevel: PriceLevel = {
  type: "level",
  levelId: "lvl-1",
  label: "Carton",
};

const priceLevelEquivalence: PriceLevel = {
  type: "equivalence",
  label: "au kg",
};

const equivalenceObject: Equivalence = {
  source: "Pièce",
  source_unit_id: EQUIV_SOURCE_ID,
  quantity: 250,
  unit: "g",
  unit_id: EQUIV_UNIT_ID,
};

// ─────────────────────────────────────────────────────────────────────────────
// buildConditioningConfig
// ─────────────────────────────────────────────────────────────────────────────

describe("buildConditioningConfig", () => {
  it("Cas A — produit simple: retourne config avec finalUnit seul", () => {
    const result = buildConditioningConfig({
      finalUnit: "Pièce",
      finalUnitId: FINAL_UNIT_ID,
      packagingLevels: [],
      effectivePriceLevel: priceLevelFinal,
      billedUnitId: null,
      equivalenceObject: null,
    });

    expect(result).not.toBeNull();
    expect(result!.finalUnit).toBe("Pièce");
    expect(result!.final_unit_id).toBe(FINAL_UNIT_ID);
    expect(result!.packagingLevels).toEqual([]);
    expect(result!.priceLevel).toEqual({
      ...priceLevelFinal,
      billed_unit_id: undefined,
    });
    expect(result!.equivalence).toBeNull();
  });

  it("Cas A — null quand ni finalUnit ni packagingLevels", () => {
    const result = buildConditioningConfig({
      finalUnit: null,
      finalUnitId: null,
      packagingLevels: [],
      effectivePriceLevel: null,
      billedUnitId: null,
      equivalenceObject: null,
    });
    expect(result).toBeNull();
  });

  it("Cas B — packaging 2 niveaux: structure JSON complète", () => {
    const result = buildConditioningConfig({
      finalUnit: "Pièce",
      finalUnitId: FINAL_UNIT_ID,
      packagingLevels: packagingCartonBoite,
      effectivePriceLevel: priceLevelLevel,
      billedUnitId: BILLED_UNIT_ID,
      equivalenceObject: null,
    });

    expect(result).not.toBeNull();
    expect(result!.packagingLevels).toHaveLength(2);
    // Deep-copied, not same reference
    expect(result!.packagingLevels[0]).not.toBe(packagingCartonBoite[0]);
    expect(result!.packagingLevels[0]).toEqual(packagingCartonBoite[0]);
    expect(result!.priceLevel).toEqual({
      ...priceLevelLevel,
      billed_unit_id: BILLED_UNIT_ID,
    });
    expect(result!.equivalence).toBeNull();
  });

  it("Cas C — avec équivalence: equivalenceObject copié", () => {
    const result = buildConditioningConfig({
      finalUnit: "Pièce",
      finalUnitId: FINAL_UNIT_ID,
      packagingLevels: [],
      effectivePriceLevel: priceLevelEquivalence,
      billedUnitId: null,
      equivalenceObject,
    });

    expect(result).not.toBeNull();
    expect(result!.equivalence).toEqual(equivalenceObject);
    // Deep-copied, not same reference
    expect(result!.equivalence).not.toBe(equivalenceObject);
  });

  it("billed_unit_id = undefined quand billedUnitId est null", () => {
    const result = buildConditioningConfig({
      finalUnit: "kg",
      finalUnitId: "uid-kg",
      packagingLevels: [],
      effectivePriceLevel: priceLevelFinal,
      billedUnitId: null,
      equivalenceObject: null,
    });

    expect(result!.priceLevel!.billed_unit_id).toBeUndefined();
  });

  it("priceLevel = null quand effectivePriceLevel est null", () => {
    const result = buildConditioningConfig({
      finalUnit: "kg",
      finalUnitId: "uid-kg",
      packagingLevels: [],
      effectivePriceLevel: null,
      billedUnitId: null,
      equivalenceObject: null,
    });

    expect(result!.priceLevel).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildConditioningResume
// ─────────────────────────────────────────────────────────────────────────────

describe("buildConditioningResume", () => {
  it("Cas A — produit simple avec finalUnit: 'Vendu à l'unité (Pièce)'", () => {
    const result = buildConditioningResume({
      packagingLevels: [],
      finalUnit: "Pièce",
    });
    expect(result).toBe("Vendu à l'unité (Pièce)");
  });

  it("Cas A — produit simple sans finalUnit: chaîne vide", () => {
    const result = buildConditioningResume({
      packagingLevels: [],
      finalUnit: null,
    });
    expect(result).toBe("");
  });

  it("Cas B — packaging 2 niveaux: premier niveau formaté", () => {
    const result = buildConditioningResume({
      packagingLevels: packagingCartonBoite,
      finalUnit: "Pièce",
    });
    expect(result).toBe("Carton de 12 Boîte");
  });

  it("Cas C — avec équivalence mais pas de packaging: finalUnit seul", () => {
    const result = buildConditioningResume({
      packagingLevels: [],
      finalUnit: "Pièce",
    });
    expect(result).toBe("Vendu à l'unité (Pièce)");
  });

  it("packaging incomplet (pas de containsQuantity): chaîne vide", () => {
    const result = buildConditioningResume({
      packagingLevels: [
        {
          id: "lvl-1",
          type: "Carton",
          containsQuantity: null,
          containsUnit: "Boîte",
        },
      ],
      finalUnit: "Pièce",
    });
    expect(result).toBe("");
  });

  it("packaging incomplet (pas de type): chaîne vide", () => {
    const result = buildConditioningResume({
      packagingLevels: [
        {
          id: "lvl-1",
          type: "",
          containsQuantity: 12,
          containsUnit: "Boîte",
        },
      ],
      finalUnit: "Pièce",
    });
    expect(result).toBe("");
  });
});
