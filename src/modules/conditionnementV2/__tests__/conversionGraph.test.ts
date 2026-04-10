/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TESTS — GRAPHE DE CONVERSION (UUID-only)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from "vitest";
import { findConversionPath } from "../conversionGraph";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import type { PackagingLevel, Equivalence } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES (UUIDs fictifs)
// ─────────────────────────────────────────────────────────────────────────────

const UNIT_PCE: UnitWithFamily = {
  id: "uuid-pce",
  name: "Pièce",
  abbreviation: "pce",
  category: "count",
  family: "count",
  is_reference: true,
  aliases: null,
};

const UNIT_G: UnitWithFamily = {
  id: "uuid-g",
  name: "Gramme",
  abbreviation: "g",
  category: "weight",
  family: "weight",
  is_reference: false,
  aliases: null,
};

const UNIT_KG: UnitWithFamily = {
  id: "uuid-kg",
  name: "Kilogramme",
  abbreviation: "kg",
  category: "weight",
  family: "weight",
  is_reference: true,
  aliases: null,
};

const UNIT_BOITE: UnitWithFamily = {
  id: "uuid-boite",
  name: "Boîte",
  abbreviation: "bte",
  category: "packaging",
  family: null,
  is_reference: false,
  aliases: null,
};

const UNIT_CARTON: UnitWithFamily = {
  id: "uuid-carton",
  name: "Carton",
  abbreviation: "ctn",
  category: "packaging",
  family: null,
  is_reference: false,
  aliases: null,
};

const ALL_UNITS = [UNIT_PCE, UNIT_G, UNIT_KG, UNIT_BOITE, UNIT_CARTON];

// DB conversions: kg↔g
const DB_CONVERSIONS: ConversionRule[] = [
  {
    id: "conv-kg-g",
    from_unit_id: "uuid-kg",
    to_unit_id: "uuid-g",
    factor: 1000,
    establishment_id: null,
    is_active: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("conversionGraph — findConversionPath", () => {
  it("same unit → factor 1", () => {
    const result = findConversionPath("uuid-kg", "uuid-kg", ALL_UNITS, DB_CONVERSIONS, [], null);
    expect(result.reached).toBe(true);
    expect(result.factor).toBe(1);
  });

  it("physique-only: kg → g via DB", () => {
    const result = findConversionPath("uuid-kg", "uuid-g", ALL_UNITS, DB_CONVERSIONS, [], null);
    expect(result.reached).toBe(true);
    expect(result.factor).toBe(1000);
  });

  it("physique-only: g → kg via DB inverse", () => {
    const result = findConversionPath("uuid-g", "uuid-kg", ALL_UNITS, DB_CONVERSIONS, [], null);
    expect(result.reached).toBe(true);
    expect(result.factor).toBeCloseTo(0.001, 6);
  });

  it("packaging-only: carton → boîte", () => {
    const levels: PackagingLevel[] = [
      {
        id: "lvl1",
        type: "Carton",
        type_unit_id: "uuid-carton",
        containsQuantity: 10,
        containsUnit: "Boîte",
        contains_unit_id: "uuid-boite",
      },
    ];
    const result = findConversionPath("uuid-carton", "uuid-boite", ALL_UNITS, [], levels, null);
    expect(result.reached).toBe(true);
    expect(result.factor).toBe(10);
  });

  it("packaging-only: boîte → carton (inverse)", () => {
    const levels: PackagingLevel[] = [
      {
        id: "lvl1",
        type: "Carton",
        type_unit_id: "uuid-carton",
        containsQuantity: 10,
        containsUnit: "Boîte",
        contains_unit_id: "uuid-boite",
      },
    ];
    const result = findConversionPath("uuid-boite", "uuid-carton", ALL_UNITS, [], levels, null);
    expect(result.reached).toBe(true);
    expect(result.factor).toBeCloseTo(0.1, 6);
  });

  it("BURRATA: kg → pce via DB(kg→g) + équivalence inverse(g→pce)", () => {
    const equivalence: Equivalence = {
      source: "Pièce",
      source_unit_id: "uuid-pce",
      quantity: 50, // 1 pce = 50 g
      unit: "Gramme",
      unit_id: "uuid-g",
    };

    const result = findConversionPath(
      "uuid-kg", "uuid-pce",
      ALL_UNITS, DB_CONVERSIONS, [], equivalence
    );
    
    expect(result.reached).toBe(true);
    // kg → g (×1000) → pce (÷50) = 20
    expect(result.factor).toBeCloseTo(20, 4);
    expect(result.path.length).toBeGreaterThan(0);
  });

  it("BURRATA prix: 5kg pour 30€ → 0.30 €/pce", () => {
    const equivalence: Equivalence = {
      source: "Pièce",
      source_unit_id: "uuid-pce",
      quantity: 50,
      unit: "Gramme",
      unit_id: "uuid-g",
    };

    const result = findConversionPath(
      "uuid-kg", "uuid-pce",
      ALL_UNITS, DB_CONVERSIONS, [], equivalence
    );
    
    expect(result.reached).toBe(true);
    // 5 kg × 20 = 100 pce; 30€ / 100 = 0.30 €/pce
    const billedQty = 5;
    const lineTotal = 30;
    const totalPce = billedQty * result.factor!;
    const pricePce = lineTotal / totalPce;
    expect(totalPce).toBe(100);
    expect(pricePce).toBeCloseTo(0.30, 2);
  });

  it("BURRATA prix boîte: 2 pce/boîte → 0.60 €/boîte", () => {
    const equivalence: Equivalence = {
      source: "Pièce",
      source_unit_id: "uuid-pce",
      quantity: 50,
      unit: "Gramme",
      unit_id: "uuid-g",
    };

    const levels: PackagingLevel[] = [
      {
        id: "lvl1",
        type: "Carton",
        type_unit_id: "uuid-carton",
        containsQuantity: 10,
        containsUnit: "Boîte",
        contains_unit_id: "uuid-boite",
      },
      {
        id: "lvl2",
        type: "Boîte",
        type_unit_id: "uuid-boite",
        containsQuantity: 2,
        containsUnit: "Pièce",
        contains_unit_id: "uuid-pce",
      },
    ];

    // kg → pce
    const kgToPce = findConversionPath(
      "uuid-kg", "uuid-pce",
      ALL_UNITS, DB_CONVERSIONS, levels, equivalence
    );
    expect(kgToPce.reached).toBe(true);
    expect(kgToPce.factor).toBeCloseTo(20, 4);

    // pce → boîte (via packaging inverse)
    const pceToBoite = findConversionPath(
      "uuid-pce", "uuid-boite",
      ALL_UNITS, DB_CONVERSIONS, levels, equivalence
    );
    expect(pceToBoite.reached).toBe(true);
    expect(pceToBoite.factor).toBeCloseTo(0.5, 4);

    // kg → boîte (full path)
    const kgToBoite = findConversionPath(
      "uuid-kg", "uuid-boite",
      ALL_UNITS, DB_CONVERSIONS, levels, equivalence
    );
    expect(kgToBoite.reached).toBe(true);
    // kg→g(1000) → pce(÷50=20) → boîte(÷2=10)
    expect(kgToBoite.factor).toBeCloseTo(10, 4);

    // 5kg × 10 = 50 boîtes; 30€/50 = 0.60 €/boîte
    const totalBoite = 5 * kgToBoite.factor!;
    const priceBoite = 30 / totalBoite;
    expect(totalBoite).toBeCloseTo(50, 2);
    expect(priceBoite).toBeCloseTo(0.60, 2);
  });

  it("cas impossible: kg → pce SANS équivalence", () => {
    const result = findConversionPath(
      "uuid-kg", "uuid-pce",
      ALL_UNITS, DB_CONVERSIONS, [], null
    );
    expect(result.reached).toBe(false);
    expect(result.factor).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("UUID manquant → erreur contrôlée", () => {
    const result = findConversionPath(null, "uuid-pce", ALL_UNITS, DB_CONVERSIONS, [], null);
    expect(result.reached).toBe(false);
    expect(result.factor).toBeNull();
  });
});
