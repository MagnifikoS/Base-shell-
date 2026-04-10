/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PIPELINE TYPES — Shared types for product pipeline orchestration
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure type definitions — no runtime code, no React, no side effects.
 * These types are consumed by resolveProductDerived.ts and future pipeline files.
 */

import type { PackagingLevel, PriceLevel, Equivalence } from "@/modules/conditionnementV2";
import type { ConditioningConfig } from "@/modules/shared/conditioningTypes";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVE INPUTS
// ─────────────────────────────────────────────────────────────────────────────

/** Input for resolveEffectiveDeliveryUnitId */
export interface DeliveryUnitInput {
  deliveryUnitId: string | null | undefined;
  packagingLevels: PackagingLevel[];
  billedUnitId: string | null;
  finalUnitId: string | null;
}

/** Input for resolveEffectiveStockHandlingUnitId */
export interface StockHandlingUnitInput {
  finalUnitId: string | null;
  billedUnitId: string | null;
  packagingLevels: PackagingLevel[];
  equivalence: Equivalence | null;
  /** DÉPENDANCE SÉQUENTIELLE : doit être calculé par resolveEffectiveDeliveryUnitId() AVANT */
  deliveryUnitId: string | null;
}

/**
 * @deprecated Equivalence removed from wizard UI.
 * resolveEquivalenceObject now always returns null.
 * Type kept for pipeline signature stability.
 */
export interface EquivalenceInput {
  hasEquivalence: boolean | null;
  equivalenceQuantity: string;
  equivalenceUnit: string;
  equivalenceUnitId: string | null;
  finalUnit: string | null;
  finalUnitId: string | null;
}

/** Input for autoDeducePriceLevel */
export interface AutoDeducePriceLevelInput {
  billedUnit: string;
  billedUnitId: string | null;
  finalUnit: string | null;
  finalUnitId: string | null;
  packagingLevels: PackagingLevel[];
}

/** Input for resolveCanonicalQuantity */
export interface CanonicalQuantityInput {
  rawQty: number | null;
  selectedUnitId: string | null;
  stockHandlingUnitId: string | null;
  deliveryUnitId: string | null;
  billedUnitId: string | null;
  finalUnitId: string | null;
  /**
   * CONTRAT : condConfig doit être identique à celui
   * produit par buildConditioningConfig() dans le même appel.
   * Ne jamais appeler cette fonction avec un condConfig
   * recalculé indépendamment.
   */
  condConfig: ConditioningConfig | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVE OUTPUTS
// ─────────────────────────────────────────────────────────────────────────────

/** Output of resolveCanonicalQuantity */
export interface CanonicalQuantityResult {
  qty: number | null;
  unitId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RE-EXPORTS for convenience
// ─────────────────────────────────────────────────────────────────────────────

export type { PackagingLevel, PriceLevel, Equivalence, ConditioningConfig, ConversionRule, UnitWithFamily };
