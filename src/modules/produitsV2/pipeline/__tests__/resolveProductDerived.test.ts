/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PR-1 VALIDATION — resolveProductDerived unit tests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests the 8 extracted functions against 3 product archetypes:
 * - Case A: Simple product (no packaging, no equivalence)
 * - Case B: Product with 2-level packaging (Carton → Boîte)
 * - Case C: Product with equivalence (Pièce = 250g)
 *
 * 8 functions × 3 cases = 24 verifications
 */

import { describe, it, expect } from "vitest";
import {
  parseLocalFloat,
  resolveEffectiveDeliveryUnitId,
  resolveEffectivePriceDisplayUnitId,
  resolveEffectiveStockHandlingUnitId,
  resolveEquivalenceObject,
  autoDeducePriceLevel,
  resolveEffectivePriceLevel,
  resolveCanonicalQuantity,
} from "../resolveProductDerived";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import type { PackagingLevel } from "@/modules/conditionnementV2";

// ─────────────────────────────────────────────────────────────────────────────
// MOCK DATA — Shared units and conversions
// ─────────────────────────────────────────────────────────────────────────────

const UNIT_PIECE: UnitWithFamily = {
  id: "unit-piece", name: "Pièce", abbreviation: "pce",
  category: "unit", family: "piece", is_reference: true, aliases: null,
};
const UNIT_KG: UnitWithFamily = {
  id: "unit-kg", name: "Kilogramme", abbreviation: "kg",
  category: "weight", family: "weight", is_reference: true, aliases: null,
};
const UNIT_G: UnitWithFamily = {
  id: "unit-g", name: "Gramme", abbreviation: "g",
  category: "weight", family: "weight", is_reference: false, aliases: null,
};
const UNIT_CARTON: UnitWithFamily = {
  id: "unit-carton", name: "Carton", abbreviation: "Crt",
  category: "packaging", family: "packaging", is_reference: false, aliases: null,
};
const UNIT_BOITE: UnitWithFamily = {
  id: "unit-boite", name: "Boîte", abbreviation: "Bte",
  category: "packaging", family: "packaging", is_reference: false, aliases: null,
};

const DB_UNITS: UnitWithFamily[] = [UNIT_PIECE, UNIT_KG, UNIT_G, UNIT_CARTON, UNIT_BOITE];

const DB_CONVERSIONS: ConversionRule[] = [
  { id: "c1", from_unit_id: "unit-g", to_unit_id: "unit-kg", factor: 0.001, establishment_id: null, is_active: true },
  { id: "c2", from_unit_id: "unit-kg", to_unit_id: "unit-g", factor: 1000, establishment_id: null, is_active: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// CASE A — Simple product (billedUnit = finalUnit = Pièce)
// ─────────────────────────────────────────────────────────────────────────────

const CASE_A = {
  finalUnit: "Pièce",
  finalUnitId: "unit-piece",
  billedUnit: "Pièce",
  billedUnitId: "unit-piece",
  packagingLevels: [] as PackagingLevel[],
  hasEquivalence: false as const,
  equivalenceQuantity: "",
  equivalenceUnit: "",
  equivalenceUnitId: null as string | null,
};

// ─────────────────────────────────────────────────────────────────────────────
// CASE B — Product with 2-level packaging (Carton → 12 Boîte, Boîte → 6 Pièce)
// ─────────────────────────────────────────────────────────────────────────────

const PACKAGING_B: PackagingLevel[] = [
  {
    id: "lvl-1", type: "Carton", type_unit_id: "unit-carton",
    containsQuantity: 12, containsUnit: "Boîte", contains_unit_id: "unit-boite",
  },
  {
    id: "lvl-2", type: "Boîte", type_unit_id: "unit-boite",
    containsQuantity: 6, containsUnit: "Pièce", contains_unit_id: "unit-piece",
  },
];

const CASE_B = {
  finalUnit: "Pièce",
  finalUnitId: "unit-piece",
  billedUnit: "Carton",
  billedUnitId: "unit-carton",
  packagingLevels: PACKAGING_B,
  hasEquivalence: false as const,
  equivalenceQuantity: "",
  equivalenceUnit: "",
  equivalenceUnitId: null as string | null,
};

// ─────────────────────────────────────────────────────────────────────────────
// CASE C — Product with equivalence (1 Pièce = 250g)
// ─────────────────────────────────────────────────────────────────────────────

const CASE_C = {
  finalUnit: "Pièce",
  finalUnitId: "unit-piece",
  billedUnit: "kg",
  billedUnitId: "unit-kg",
  packagingLevels: [] as PackagingLevel[],
  hasEquivalence: true as const,
  equivalenceQuantity: "250",
  equivalenceUnit: "g",
  equivalenceUnitId: "unit-g",
};

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveProductDerived — PR-1 validation", () => {
  // ── 1. parseLocalFloat ──────────────────────────────────────────────────

  describe("parseLocalFloat", () => {
    it("Case A: parses standard number", () => {
      expect(parseLocalFloat("10.5")).toBe(10.5);
    });
    it("Case B: parses French decimal (comma)", () => {
      expect(parseLocalFloat("12,99")).toBe(12.99);
    });
    it("Case C: handles null/empty", () => {
      expect(parseLocalFloat(null)).toBe(0);
      expect(parseLocalFloat(undefined)).toBe(0);
      expect(parseLocalFloat("")).toBe(0);
    });
  });

  // ── 2. resolveEffectiveDeliveryUnitId ─────────────────────────────────

  describe("resolveEffectiveDeliveryUnitId", () => {
    it("Case A: simple → returns billedUnitId (same as final)", () => {
      const result = resolveEffectiveDeliveryUnitId(
        { deliveryUnitId: null, ...CASE_A },
        DB_UNITS
      );
      // billedUnitId = finalUnitId = piece, not weight/volume → branch 5 returns billedId
      expect(result).toBe("unit-piece");
    });

    it("Case B: packaging → returns first packaging level type_unit_id", () => {
      const result = resolveEffectiveDeliveryUnitId(
        { deliveryUnitId: null, ...CASE_B },
        DB_UNITS
      );
      expect(result).toBe("unit-carton");
    });

    it("Case C: equivalence (billed=kg, weight) → falls back to finalUnitId", () => {
      const result = resolveEffectiveDeliveryUnitId(
        { deliveryUnitId: null, ...CASE_C },
        DB_UNITS
      );
      // billedUnitId=kg, family=weight → branch 4 returns finalUnitId
      expect(result).toBe("unit-piece");
    });
  });

  // ── 3. resolveEffectivePriceDisplayUnitId ──────────────────────────────

  describe("resolveEffectivePriceDisplayUnitId", () => {
    it("Case A: no explicit → fallback to finalUnitId", () => {
      expect(resolveEffectivePriceDisplayUnitId(null, "unit-piece")).toBe("unit-piece");
    });
    it("Case B: explicit selection → keeps it", () => {
      expect(resolveEffectivePriceDisplayUnitId("unit-carton", "unit-piece")).toBe("unit-carton");
    });
    it("Case C: null both → null", () => {
      expect(resolveEffectivePriceDisplayUnitId(null, null)).toBeNull();
    });
  });

  // ── 4. resolveEffectiveStockHandlingUnitId ─────────────────────────────

  describe("resolveEffectiveStockHandlingUnitId", () => {
    it("Case A: simple → returns finalUnitId (canonical = piece)", () => {
      const result = resolveEffectiveStockHandlingUnitId(
        {
          finalUnitId: CASE_A.finalUnitId,
          billedUnitId: CASE_A.billedUnitId,
          packagingLevels: CASE_A.packagingLevels,
          equivalence: null,
          deliveryUnitId: "unit-piece",
        },
        DB_UNITS,
        DB_CONVERSIONS
      );
      // For simple product with piece final, canonical should be piece
      expect(result).toBe("unit-piece");
    });

    it("Case B: packaging → delegates to resolveWizardUnitContext", () => {
      const result = resolveEffectiveStockHandlingUnitId(
        {
          finalUnitId: CASE_B.finalUnitId,
          billedUnitId: CASE_B.billedUnitId,
          packagingLevels: CASE_B.packagingLevels,
          equivalence: null,
          deliveryUnitId: "unit-carton",
        },
        DB_UNITS,
        DB_CONVERSIONS
      );
      // With packaging, canonical should resolve through BFS
      expect(result).not.toBeNull();
    });

    it("Case C: equivalence → resolves canonical through BFS", () => {
      const equivalence = resolveEquivalenceObject({
        ...CASE_C,
      });
      const result = resolveEffectiveStockHandlingUnitId(
        {
          finalUnitId: CASE_C.finalUnitId,
          billedUnitId: CASE_C.billedUnitId,
          packagingLevels: CASE_C.packagingLevels,
          equivalence,
          deliveryUnitId: "unit-piece",
        },
        DB_UNITS,
        DB_CONVERSIONS
      );
      expect(result).not.toBeNull();
    });

    it("returns null when finalUnitId is null", () => {
      const result = resolveEffectiveStockHandlingUnitId(
        {
          finalUnitId: null,
          billedUnitId: null,
          packagingLevels: [],
          equivalence: null,
          deliveryUnitId: null,
        },
        DB_UNITS,
        DB_CONVERSIONS
      );
      expect(result).toBeNull();
    });
  });

  // ── 5. resolveEquivalenceObject ────────────────────────────────────────

  describe("resolveEquivalenceObject", () => {
    it("Case A: no equivalence → null", () => {
      const result = resolveEquivalenceObject({
        hasEquivalence: false,
        equivalenceQuantity: "",
        equivalenceUnit: "",
        equivalenceUnitId: null,
        finalUnit: CASE_A.finalUnit,
        finalUnitId: CASE_A.finalUnitId,
      });
      expect(result).toBeNull();
    });

    it("Case B: no equivalence → null", () => {
      const result = resolveEquivalenceObject({
        hasEquivalence: false,
        equivalenceQuantity: "",
        equivalenceUnit: "",
        equivalenceUnitId: null,
        finalUnit: CASE_B.finalUnit,
        finalUnitId: CASE_B.finalUnitId,
      });
      expect(result).toBeNull();
    });

    it("Case C: equivalence → returns complete object", () => {
      const result = resolveEquivalenceObject({
        hasEquivalence: true,
        equivalenceQuantity: "250",
        equivalenceUnit: "g",
        equivalenceUnitId: "unit-g",
        finalUnit: "Pièce",
        finalUnitId: "unit-piece",
      });
      expect(result).toEqual({
        source: "Pièce",
        source_unit_id: "unit-piece",
        quantity: 250,
        unit: "g",
        unit_id: "unit-g",
      });
    });

    it("returns null for invalid quantity", () => {
      const result = resolveEquivalenceObject({
        hasEquivalence: true,
        equivalenceQuantity: "abc",
        equivalenceUnit: "g",
        equivalenceUnitId: "unit-g",
        finalUnit: "Pièce",
        finalUnitId: "unit-piece",
      });
      expect(result).toBeNull();
    });
  });

  // ── 6. autoDeducePriceLevel ────────────────────────────────────────────

  describe("autoDeducePriceLevel", () => {
    it("Case A: billed=final → type 'final'", () => {
      const result = autoDeducePriceLevel({
        billedUnit: CASE_A.billedUnit,
        billedUnitId: CASE_A.billedUnitId,
        finalUnit: CASE_A.finalUnit,
        finalUnitId: CASE_A.finalUnitId,
        packagingLevels: CASE_A.packagingLevels,
      });
      expect(result).toEqual({ type: "final", label: "à l'unité (Pièce)" });
    });

    it("Case B: billed=Carton matches packaging level → type 'level'", () => {
      const result = autoDeducePriceLevel({
        billedUnit: CASE_B.billedUnit,
        billedUnitId: CASE_B.billedUnitId,
        finalUnit: CASE_B.finalUnit,
        finalUnitId: CASE_B.finalUnitId,
        packagingLevels: CASE_B.packagingLevels,
      });
      expect(result).toEqual({ type: "level", levelId: "lvl-1", label: "au Carton" });
    });

    it("Case C: billed=kg, final=piece, no packaging match → type 'billed_physical'", () => {
      const result = autoDeducePriceLevel({
        billedUnit: CASE_C.billedUnit,
        billedUnitId: CASE_C.billedUnitId,
        finalUnit: CASE_C.finalUnit,
        finalUnitId: CASE_C.finalUnitId,
        packagingLevels: CASE_C.packagingLevels,
      });
      expect(result).toEqual({
        type: "billed_physical",
        billedUnit: "kg",
        billed_unit_id: "unit-kg",
        label: "au kg",
      });
    });

    it("returns null when billedUnit is empty", () => {
      const result = autoDeducePriceLevel({
        billedUnit: "",
        billedUnitId: null,
        finalUnit: null,
        finalUnitId: null,
        packagingLevels: [],
      });
      expect(result).toBeNull();
    });

    it("Branch 4: finalUnit fallback when billedUnit text-only (no UUIDs)", () => {
      const result = autoDeducePriceLevel({
        billedUnit: "something",
        billedUnitId: null,
        finalUnit: "Pièce",
        finalUnitId: null,
        packagingLevels: [],
      });
      // No billedUnitId → skip branches 1,2,3 → branch 4 finalUnit exists
      expect(result).toEqual({ type: "final", label: "à l'unité (Pièce)" });
    });
  });

  // ── 7. resolveEffectivePriceLevel ──────────────────────────────────────

  describe("resolveEffectivePriceLevel", () => {
    it("Case A: auto-deduced wins over manual", () => {
      const auto = { type: "final" as const, label: "à l'unité (Pièce)" };
      const manual = { type: "level" as const, levelId: "x", label: "au Carton" };
      expect(resolveEffectivePriceLevel(auto, manual)).toBe(auto);
    });

    it("Case B: no auto → manual used", () => {
      const manual = { type: "level" as const, levelId: "x", label: "au Carton" };
      expect(resolveEffectivePriceLevel(null, manual)).toBe(manual);
    });

    it("Case C: both null → null", () => {
      expect(resolveEffectivePriceLevel(null, null)).toBeNull();
    });
  });

  // ── 8. resolveCanonicalQuantity ────────────────────────────────────────

  describe("resolveCanonicalQuantity", () => {
    it("Case A: same unit → rounds to 4 decimals", () => {
      const result = resolveCanonicalQuantity(
        {
          rawQty: 10,
          selectedUnitId: "unit-piece",
          stockHandlingUnitId: "unit-piece",
          deliveryUnitId: "unit-piece",
          billedUnitId: "unit-piece",
          finalUnitId: "unit-piece",
          condConfig: null,
        },
        DB_UNITS,
        DB_CONVERSIONS
      );
      expect(result.qty).toBe(10);
      expect(result.unitId).toBe("unit-piece");
    });

    it("Case B: returns valid result for packaging context", () => {
      const result = resolveCanonicalQuantity(
        {
          rawQty: 5,
          selectedUnitId: "unit-piece",
          stockHandlingUnitId: "unit-piece",
          deliveryUnitId: "unit-carton",
          billedUnitId: "unit-carton",
          finalUnitId: "unit-piece",
          condConfig: null,
        },
        DB_UNITS,
        DB_CONVERSIONS
      );
      expect(result.qty).not.toBeNull();
      expect(result.unitId).not.toBeNull();
    });

    it("Case C: null qty → null result", () => {
      const result = resolveCanonicalQuantity(
        {
          rawQty: null,
          selectedUnitId: "unit-piece",
          stockHandlingUnitId: "unit-piece",
          deliveryUnitId: "unit-piece",
          billedUnitId: "unit-kg",
          finalUnitId: "unit-piece",
          condConfig: null,
        },
        DB_UNITS,
        DB_CONVERSIONS
      );
      expect(result.qty).toBeNull();
      expect(result.unitId).toBeNull();
    });

    it("zero qty → null result", () => {
      const result = resolveCanonicalQuantity(
        {
          rawQty: 0,
          selectedUnitId: "unit-piece",
          stockHandlingUnitId: "unit-piece",
          deliveryUnitId: "unit-piece",
          billedUnitId: "unit-piece",
          finalUnitId: "unit-piece",
          condConfig: null,
        },
        DB_UNITS,
        DB_CONVERSIONS
      );
      expect(result.qty).toBeNull();
    });

    it("null selectedUnitId → null result", () => {
      const result = resolveCanonicalQuantity(
        {
          rawQty: 10,
          selectedUnitId: null,
          stockHandlingUnitId: "unit-piece",
          deliveryUnitId: "unit-piece",
          billedUnitId: "unit-piece",
          finalUnitId: "unit-piece",
          condConfig: null,
        },
        DB_UNITS,
        DB_CONVERSIONS
      );
      expect(result.qty).toBeNull();
    });
  });
});
