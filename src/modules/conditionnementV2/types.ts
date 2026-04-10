/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE CONDITIONNEMENT V2 — TYPES
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";

/**
 * Unité finale de référence pour le stock
 * Peut être une unité de mesure (pce, kg, L) OU un type de conditionnement (Bouteille, Caisse, etc.)
 */
export type FinalUnit = string;

/**
 * @deprecated — Hardcoded abbreviations removed (Étape 3).
 * All unit lookups must go through measurement_units table.
 */
export const BASE_UNIT_ABBREVIATIONS: Record<string, string> = {};

/**
 * @deprecated — Hardcoded suggestions removed (Étape 3).
 * Wizard now reads from measurement_units DB only.
 */
export const PACKAGING_TYPE_SUGGESTIONS: string[] = [];

/**
 * @deprecated — Hardcoded suggestions removed (Étape 3).
 * Wizard now reads from measurement_units DB only.
 */
export const BASE_UNIT_SUGGESTIONS: { name: string; abbreviation: string }[] = [];

/**
 * Un niveau de conditionnement
 */
export interface PackagingLevel {
  id: string;
  type: string;
  /** UUID FK → measurement_units.id (SSOT, added by migration) */
  type_unit_id?: string | null;
  containsQuantity: number | null;
  containsUnit: string;
  /** UUID FK → measurement_units.id (SSOT, added by migration) */
  contains_unit_id?: string | null;
}

/**
 * Données facture brutes
 */
export interface InvoiceData {
  billedQuantity: number | null;
  billedUnit: string;
  /** UUID FK → measurement_units.id (SSOT for billed unit) */
  billedUnitId?: string | null;
  lineTotal: number | null;
  unitPriceBilled: number | null;
}

/**
 * Niveau auquel le prix correspond
 */
export interface PriceLevel {
  type: "final" | "level" | "equivalence" | "billed_physical";
  levelId?: string;
  billedUnit?: string;
  /** UUID FK → measurement_units.id (for billed_physical type) */
  billed_unit_id?: string | null;
  label: string;
}

/**
 * Équivalence : conversion entre une source et une unité de mesure
 */
export interface Equivalence {
  source: string;
  /** UUID FK → measurement_units.id (SSOT for equivalence source unit, e.g. "Pièce") */
  source_unit_id?: string | null;
  quantity: number;
  unit: string;
  /** UUID FK → measurement_units.id (SSOT for equivalence target unit, e.g. "g") */
  unit_id?: string | null;
}

/**
 * Entrée complète pour le moteur de calcul
 */
export interface CalculationInput {
  finalUnit: FinalUnit | null;
  /** UUID FK → measurement_units.id */
  finalUnitId?: string | null;
  packagingLevels: PackagingLevel[];
  invoiceData: InvoiceData;
  priceLevel: PriceLevel | null;
  equivalence?: Equivalence | null;
  /** DB-driven conversion data (required for physical conversions) */
  units?: UnitWithFamily[];
  conversions?: ConversionRule[];
}

/**
 * Résultat du calcul
 */
export interface CalculationResult {
  quantityFinalTotal: number | null;
  unitPriceFinal: number | null;
  totalComputed: number | null;
  isCoherent: boolean;
  warnings: string[];
}

/**
 * Résultat d'une résolution de facteur (packagingResolver)
 */
export interface FactorResult {
  factor: number | null;
  reached: boolean;
  warnings: string[];
  path: string[];
}
