/**
 * Tests for the ERP Quantity Display Engine
 */

import { describe, it, expect } from "vitest";
import { formatErpQuantity } from "../formatErpQuantity";
import type { ReachableUnit } from "@/core/unitConversion/resolveProductUnitContext";

// Helper to create ReachableUnit
function unit(
  id: string,
  name: string,
  abbreviation: string,
  factorToTarget: number,
  kind: ReachableUnit["kind"] = "packaging",
): ReachableUnit {
  return { id, name, abbreviation, kind, factorToTarget };
}

// ── Setup A: canonical = Pièce (smallest), packaging units BIGGER ──
const CARTON_BOITE_UP: ReachableUnit[] = [
  unit("pce", "Pièce", "pce", 1, "target"),
  unit("carton", "Carton", "car", 10, "packaging"),
];

const PACK_BOUTEILLE: ReachableUnit[] = [
  unit("bouteille", "Bouteille", "btl", 1, "target"),
  unit("pack", "Pack", "pk", 6, "packaging"),
];

const THREE_LEVELS_UP: ReachableUnit[] = [
  unit("pce", "Pièce", "pce", 1, "target"),
  unit("carton", "Carton", "car", 10, "packaging"),
  unit("palette", "Palette", "pal", 100, "packaging"),
];

// ── Setup B: canonical = Carton (largest), sub-units SMALLER ──
// Real-world case: Carton(1) → Boîte(0.1, 10/carton) → Pièce(0.05, 2/boîte)
const CARTON_BOITE_DOWN: ReachableUnit[] = [
  unit("carton", "Carton", "car", 1, "target"),
  unit("boite", "Boîte", "bte", 0.1, "packaging"),
  unit("pce", "Pièce", "pce", 0.05, "packaging"),
];

// ── Setup C: canonical = Carton, only Boîte sub-unit (no Pièce) ──
const CARTON_BOITE_ONLY: ReachableUnit[] = [
  unit("carton", "Carton", "car", 1, "target"),
  unit("boite", "Boîte", "bte", 0.1, "packaging"),
];

describe("formatErpQuantity", () => {
  // ═══════════════════════════════════════════════════════════════
  // DIRECTION A: canonical = smallest (factor=1 is smallest unit)
  // ═══════════════════════════════════════════════════════════════

  describe("canonical = smallest (upward decomposition)", () => {
    it("13 pce → '1 Carton + 3 pce'", () => {
      const result = formatErpQuantity(13, CARTON_BOITE_UP);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(2);
      expect(result!.segments[0]).toMatchObject({ unitName: "Carton", quantity: 1 });
      expect(result!.segments[1]).toMatchObject({ unitName: "Pièce", quantity: 3 });
      expect(result!.label).toBe("1 Carton + 3 pce");
    });

    it("10 pce (exact) → '1 Carton'", () => {
      const result = formatErpQuantity(10, CARTON_BOITE_UP);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(1);
      expect(result!.label).toBe("1 Carton");
    });

    it("20 pce → '2 Carton'", () => {
      const result = formatErpQuantity(20, CARTON_BOITE_UP);
      expect(result).not.toBeNull();
      expect(result!.label).toBe("2 Carton");
    });

    it("5 pce (< 1 Carton) → shows in canonical '5 pce'", () => {
      const result = formatErpQuantity(5, CARTON_BOITE_UP);
      expect(result).not.toBeNull();
      expect(result!.label).toBe("5 pce");
    });

    it("3 bouteilles (< 1 pack) → shows in canonical '3 Bouteille'", () => {
      const result = formatErpQuantity(3, PACK_BOUTEILLE);
      expect(result).not.toBeNull();
      expect(result!.label).toBe("3 Bouteille");
    });

    it("135 pce 3-level: maxLevels=2 → '1 Palette + 3.5 Carton'", () => {
      const result = formatErpQuantity(135, THREE_LEVELS_UP, 2);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(2);
      expect(result!.segments[0]).toMatchObject({ unitName: "Palette", quantity: 1 });
      expect(result!.segments[1]).toMatchObject({ unitName: "Carton", quantity: 3.5 });
    });

    it("135 pce 3-level: maxLevels=3 shows all", () => {
      const result = formatErpQuantity(135, THREE_LEVELS_UP, 3);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(3);
      expect(result!.segments[2].quantity).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // DIRECTION B: canonical = largest (factor=1 is largest unit)
  // ★ ROOT CAUSE BUG WAS HERE — canonical absorbed fractions
  // ═══════════════════════════════════════════════════════════════

  describe("canonical = largest (downward decomposition)", () => {
    it("★ GOLDEN 1: 1.25 Carton → '1 Carton + 2 Boîte + 1 pce'", () => {
      // 1.25 Carton: 1 whole Carton, 0.25 Carton = 2.5 Boîte = 2 Boîte + 1 Pièce
      const result = formatErpQuantity(1.25, CARTON_BOITE_DOWN);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(3);
      expect(result!.segments[0]).toMatchObject({ unitName: "Carton", quantity: 1 });
      expect(result!.segments[1]).toMatchObject({ unitName: "Boîte", quantity: 2 });
      expect(result!.segments[2]).toMatchObject({ unitName: "Pièce", quantity: 1 });
      expect(result!.label).toBe("1 Carton + 2 Boîte + 1 pce");
    });

    it("★ GOLDEN 2: 0.2 Carton → '2 Boîte'", () => {
      const result = formatErpQuantity(0.2, CARTON_BOITE_DOWN);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(1);
      expect(result!.segments[0]).toMatchObject({ unitName: "Boîte", quantity: 2 });
    });

    it("★ GOLDEN 3: 2.5 Boîte equivalent (0.25 Carton) → '2 Boîte + 1 pce'", () => {
      // 0.25 Carton = 2.5 Boîte = 2 Boîte + 1 Pièce
      const result = formatErpQuantity(0.25, CARTON_BOITE_DOWN);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(2);
      expect(result!.segments[0]).toMatchObject({ unitName: "Boîte", quantity: 2 });
      expect(result!.segments[1]).toMatchObject({ unitName: "Pièce", quantity: 1 });
    });

    it("1.2 Carton → '1 Carton + 2 Boîte'", () => {
      const result = formatErpQuantity(1.2, CARTON_BOITE_DOWN);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(2);
      expect(result!.segments[0]).toMatchObject({ unitName: "Carton", quantity: 1 });
      expect(result!.segments[1]).toMatchObject({ unitName: "Boîte", quantity: 2 });
      expect(result!.label).toBe("1 Carton + 2 Boîte");
    });

    it("0.05 Carton → '1 pce'", () => {
      const result = formatErpQuantity(0.05, CARTON_BOITE_DOWN);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(1);
      expect(result!.segments[0]).toMatchObject({ unitName: "Pièce", quantity: 1 });
    });

    it("1 Carton (exact) → '1 Carton'", () => {
      const result = formatErpQuantity(1, CARTON_BOITE_DOWN);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(1);
      expect(result!.label).toBe("1 Carton");
    });

    it("2 Carton (exact) → '2 Carton'", () => {
      const result = formatErpQuantity(2, CARTON_BOITE_DOWN);
      expect(result).not.toBeNull();
      expect(result!.label).toBe("2 Carton");
    });

    it("1.35 Carton → '1 Carton + 3 Boîte + 1 pce'", () => {
      const result = formatErpQuantity(1.35, CARTON_BOITE_DOWN);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(3);
      expect(result!.segments[0]).toMatchObject({ unitName: "Carton", quantity: 1 });
      expect(result!.segments[1]).toMatchObject({ unitName: "Boîte", quantity: 3 });
      expect(result!.segments[2]).toMatchObject({ unitName: "Pièce", quantity: 1 });
    });

    it("1.35 Carton with maxLevels=2 → stops at 2 segments", () => {
      const result = formatErpQuantity(1.35, CARTON_BOITE_DOWN, 2);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(2);
      expect(result!.segments[0]).toMatchObject({ unitName: "Carton", quantity: 1 });
      // Last level absorbs remainder: 0.35 Carton / 0.1 = 3.5 Boîte
      expect(result!.segments[1]).toMatchObject({ unitName: "Boîte", quantity: 3.5 });
    });

    it("fractional remainder on 2-level chain: 0.15 Carton → '1 Boîte + 1 pce'", () => {
      const result = formatErpQuantity(0.15, CARTON_BOITE_DOWN);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(2);
      expect(result!.segments[0]).toMatchObject({ unitName: "Boîte", quantity: 1 });
      expect(result!.segments[1]).toMatchObject({ unitName: "Pièce", quantity: 1 });
    });

    it("no sub-sub-unit: 1.25 Carton with only Boîte → '1 Carton + 2.5 Boîte'", () => {
      // With only 2 units, the last unit absorbs the fractional remainder
      const result = formatErpQuantity(1.25, CARTON_BOITE_ONLY);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(2);
      expect(result!.segments[0]).toMatchObject({ unitName: "Carton", quantity: 1 });
      expect(result!.segments[1]).toMatchObject({ unitName: "Boîte", quantity: 2.5 });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Edge cases
  // ═══════════════════════════════════════════════════════════════

  describe("edge cases", () => {
    it("zero → '0 <canonical>'", () => {
      const result = formatErpQuantity(0, CARTON_BOITE_DOWN);
      expect(result).not.toBeNull();
      expect(result!.label).toBe("0 Carton");
    });

    it("returns qty in canonical when no packaging units", () => {
      const onlyCanonical: ReachableUnit[] = [
        unit("pce", "Pièce", "pce", 1, "target"),
      ];
      const result = formatErpQuantity(5, onlyCanonical);
      expect(result).not.toBeNull();
      expect(result!.label).toBe("5 pce");
    });

    it("returns null with empty options", () => {
      expect(formatErpQuantity(5, [])).toBeNull();
    });

    it("handles very small remainder (float precision)", () => {
      // 0.3 Carton = exactly 3 Boîte (no remainder despite float math)
      const result = formatErpQuantity(0.3, CARTON_BOITE_DOWN);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(1);
      expect(result!.segments[0]).toMatchObject({ unitName: "Boîte", quantity: 3 });
    });

    it("cross-family units are excluded from decomposition", () => {
      // Sachet (canonical, count) + kg (physical, weight) should NOT mix families
      const MIXED_FAMILY: ReachableUnit[] = [
        unit("sachet", "Sachet", "sac", 1, "target"),
        unit("carton", "Carton", "car", 10, "packaging"),
        unit("kg", "Kilogramme", "kg", 0.35, "physical"),
      ];
      // 15 sachets = 1 Carton + 5 Sachet, NOT "0.xx kg + ..."
      const result = formatErpQuantity(15, MIXED_FAMILY);
      expect(result).not.toBeNull();
      expect(result!.segments).toHaveLength(2);
      expect(result!.segments[0]).toMatchObject({ unitName: "Carton", quantity: 1 });
      expect(result!.segments[1]).toMatchObject({ unitName: "Sachet", quantity: 5 });
      // No kg in output
      expect(result!.segments.every(s => s.unitName !== "Kilogramme")).toBe(true);
    });
  });
});
